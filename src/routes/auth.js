const express = require('express');
const { body, validationResult } = require('express-validator');
const { OAuth2Client } = require('google-auth-library');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('../generated/client');

const router = express.Router();
const prisma = new PrismaClient();

// Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Validation middleware
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed', 
      details: errors.array() 
    });
  }
  next();
};

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign(
    { userId: userId.toString(), iat: Date.now() },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '7d' }
  );
};

// Google OAuth for mobile
router.post('/google-mobile', [
  body('idToken').notEmpty().withMessage('ID token is required')
], validateRequest, async (req, res) => {
  try {
    const { idToken } = req.body;

    // Verify Google token
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { email, name, picture, sub: googleId } = payload;

    // Check if user exists
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { email },
          { auth_provider: 'google', email }
        ]
      }
    });

    if (!user) {
      // Create new user
      user = await prisma.user.create({
        data: {
          email,
          name,
          profile_image_url: picture,
          auth_provider: 'google',
          email_verified: true,
          user_type: 'creator', // Default to creator for now
          status: 'active'
        }
      });
    } else {
      // Update existing user
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          last_login_at: new Date(),
          profile_image_url: picture,
          email_verified: true
        }
      });
    }

    // Generate JWT token
    const token = generateToken(user.id);

    res.json({
      success: true,
      message: 'Google authentication successful',
      user: {
        id: user.id.toString(),
        email: user.email,
        name: user.name,
        profileImage: user.profile_image_url,
        isVerified: user.email_verified
      },
      token
    });

  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({ 
      error: 'Google authentication failed',
      message: error.message 
    });
  }
});

// Send phone verification code
router.post('/send-phone-verification-code', [
  body('phone').isMobilePhone().withMessage('Valid phone number is required')
], validateRequest, async (req, res) => {
  try {
    const { phone } = req.body;
    
    // Check for recent OTP requests to prevent spam
    const recentVerification = await prisma.phoneVerification.findFirst({
      where: {
        phone,
        created_at: { gt: new Date(Date.now() - 60 * 1000) } // Last 1 minute
      }
    });
    
    if (recentVerification) {
      return res.status(429).json({
        error: 'Please wait 1 minute before requesting another code'
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Generate unique token
    const token = require('crypto').randomBytes(32).toString('hex');
    
    // Store OTP in database
    await prisma.phoneVerification.create({
      data: {
        phone,
        code: otp,
        token,
        expires_at: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
      }
    });

    // Send SMS using Twilio Verify (if configured)
    let smsSent = false;
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID) {
      const twilio = require('twilio')(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );

      try {
        await twilio.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID)
          .verifications.create({
            to: phone,
            channel: 'sms'
          });
        console.log(`Verification SMS sent to ${phone}`);
        smsSent = true;
      } catch (smsError) {
        console.error('SMS sending failed:', smsError);
        
        // Handle rate limiting specifically
        if (smsError.status === 429) {
          console.log(`Rate limit hit for ${phone}. OTP: ${otp} (check console for development)`);
          console.log(`Please wait before requesting another code or upgrade your Twilio plan`);
        } else {
          console.log(`OTP for ${phone}: ${otp} (SMS failed, using console log)`);
        }
      }
    } else {
      // Development mode - just log the OTP
      console.log(`OTP for ${phone}: ${otp} (Twilio not configured)`);
    }

    res.json({
      success: true,
      message: 'Verification code sent successfully',
      phone
    });

  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ 
      error: 'Failed to send verification code',
      message: error.message 
    });
  }
});

// Verify phone code
router.post('/verify-phone-code', [
  body('phone').isMobilePhone().withMessage('Valid phone number is required'),
  body('code').isLength({ min: 6, max: 6 }).withMessage('6-digit code is required'),
  body('fullName').optional().isString().withMessage('Full name must be a string')
], validateRequest, async (req, res) => {
  try {
    const { phone, code, fullName } = req.body;

    // Verify with Twilio Verify (if configured)
    let twilioVerification = false;
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID) {
      const twilio = require('twilio')(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );

      try {
        const verificationCheck = await twilio.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID)
          .verificationChecks.create({
            to: phone,
            code: code
          });

        if (verificationCheck.status === 'approved') {
          twilioVerification = true;
        } else {
          return res.status(400).json({ 
            error: 'Invalid verification code' 
          });
        }
      } catch (verifyError) {
        console.error('Twilio verification failed:', verifyError);
        
        // If Twilio fails (rate limit, etc.), fall back to database verification
        if (verifyError.status === 429) {
          console.log('Twilio rate limit hit, falling back to database verification');
        } else {
          console.log('Twilio verification error, falling back to database verification');
        }
      }
    }
    
    // If Twilio verification failed or not configured, use database verification
    if (!twilioVerification) {
      // Fallback to database verification for development
      const verification = await prisma.phoneVerification.findFirst({
        where: {
          phone,
          code,
          expires_at: { gt: new Date() },
          verified_at: null
        },
        orderBy: { created_at: 'desc' }
      });

      if (!verification) {
        return res.status(400).json({ 
          error: 'Invalid or expired verification code' 
        });
      }

      // Mark as verified
      await prisma.phoneVerification.update({
        where: { id: verification.id },
        data: { verified_at: new Date() }
      });
    }

    // Check if user exists with this phone
    let user = await prisma.user.findUnique({
      where: { phone }
    });

    if (!user) {
      // Create new user with full name
      user = await prisma.user.create({
        data: {
          phone,
          phone_verified: true,
          user_type: 'creator', // Default to creator
          status: 'active',
          name: fullName || 'User' // Use provided full name or default
        }
      });
    } else {
      // Update existing user
      user = await prisma.user.update({
        where: { id: user.id },
        data: { 
          phone_verified: true,
          last_login_at: new Date(),
          ...(fullName && { name: fullName }) // Update name if provided
        }
      });
    }

    // Generate JWT token
    const token = generateToken(user.id);

    res.json({
      success: true,
      message: 'Phone verification successful',
      user: {
        id: user.id.toString(),
        phone: user.phone,
        name: user.name,
        isVerified: user.phone_verified
      },
      token
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ 
      error: 'Phone verification failed',
      message: error.message 
    });
  }
});

// Update user name (for phone signup flow)
router.post('/update-name', [
  body('name').notEmpty().withMessage('Name is required')
], validateRequest, async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const { name } = req.body;

    const user = await prisma.user.update({
      where: { id: decoded.userId },
      data: { name }
    });

    res.json({
      success: true,
      message: 'Name updated successfully',
      user: {
        id: user.id.toString(),
        name: user.name,
        email: user.email,
        phone: user.phone
      }
    });

  } catch (error) {
    console.error('Update name error:', error);
    res.status(500).json({ 
      error: 'Failed to update name',
      message: error.message 
    });
  }
});

// Get user profile
router.get('/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user: {
        id: user.id.toString(),
        email: user.email,
        name: user.name,
        phone: user.phone,
        profileImage: user.profile_image_url,
        isVerified: user.email_verified || user.phone_verified,
        userType: user.user_type,
        status: user.status
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router; 