const express = require('express');
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('../generated/client');

const router = express.Router();
const prisma = new PrismaClient();

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

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Update user basic info (from ProfileSetupScreen)
router.post('/update-basic-info', [
  body('gender').isIn(['Male', 'Female', 'Other']).withMessage('Valid gender is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('dob').notEmpty().withMessage('Date of birth is required'),
  body('state').notEmpty().withMessage('State is required'),
  body('city').notEmpty().withMessage('City is required'),
  body('pincode').notEmpty().withMessage('Pincode is required')
], validateRequest, authenticateToken, async (req, res) => {
  try {
    const { gender, email, dob, state, city, pincode } = req.body;
    const userId = BigInt(req.userId);

    // Parse date of birth
    const dateOfBirth = new Date(dob);

    // Update user email
    await prisma.user.update({
      where: { id: userId },
      data: { 
        email,
        email_verified: true,
        onboarding_step: 2
      }
    });

    // Create or update creator profile
    const creatorProfile = await prisma.creatorProfile.upsert({
      where: { user_id: userId },
      update: {
        gender,
        date_of_birth: dateOfBirth,
        location_state: state,
        location_city: city,
        location_pincode: pincode
      },
      create: {
        user_id: userId,
        gender,
        date_of_birth: dateOfBirth,
        location_state: state,
        location_city: city,
        location_pincode: pincode
      }
    });

    res.json({
      success: true,
      message: 'Basic info updated successfully',
      profile: creatorProfile
    });

  } catch (error) {
    console.error('Update basic info error:', error);
    res.status(500).json({ 
      error: 'Failed to update basic info',
      message: error.message 
    });
  }
});

// Update creator preferences (from CreatorPreferencesScreen)
router.post('/update-preferences', [
  body('categories').isArray({ min: 1, max: 5 }).withMessage('1-5 categories required'),
  body('about').notEmpty().withMessage('About is required'),
  body('languages').isArray({ min: 1 }).withMessage('At least one language required')
], validateRequest, authenticateToken, async (req, res) => {
  try {
    const { categories, about, languages } = req.body;
    const userId = BigInt(req.userId);

    // Create or update creator profile
    const creatorProfile = await prisma.creatorProfile.upsert({
      where: { user_id: userId },
      update: {
        content_categories: categories,
        bio: about,
        interests: languages
      },
      create: {
        user_id: userId,
        content_categories: categories,
        bio: about,
        interests: languages
      }
    });

    // Update user onboarding step
    await prisma.user.update({
      where: { id: userId },
      data: { onboarding_step: 1 }
    });

    res.json({
      success: true,
      message: 'Preferences updated successfully',
      profile: creatorProfile
    });

  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({ 
      error: 'Failed to update preferences',
      message: error.message 
    });
  }
});

// Create package (from CreatePackageScreen)
router.post('/create-package', [
  body('platform').notEmpty().withMessage('Platform is required'),
  body('contentType').notEmpty().withMessage('Content type is required'),
  body('quantity').isInt({ min: 1 }).withMessage('Valid quantity required'),
  body('revisions').isInt({ min: 0 }).withMessage('Valid revisions required'),
  body('duration1').notEmpty().withMessage('Duration 1 is required'),
  body('duration2').notEmpty().withMessage('Duration 2 is required'),
  body('price').isFloat({ min: 0 }).withMessage('Valid price required'),
  body('description').optional()
], validateRequest, authenticateToken, async (req, res) => {
  try {
    const { 
      platform, 
      contentType, 
      quantity, 
      revisions, 
      duration1, 
      duration2, 
      price, 
      description 
    } = req.body;
    const userId = BigInt(req.userId);

    // Get creator profile
    const creatorProfile = await prisma.creatorProfile.findUnique({
      where: { user_id: userId }
    });

    if (!creatorProfile) {
      return res.status(400).json({ error: 'Creator profile not found' });
    }

    // Create package
    const package = await prisma.package.create({
      data: {
        creator_id: creatorProfile.id,
        package_type: 'content',
        title: `${platform} ${contentType}`,
        description: description || '',
        platform: platform.toUpperCase(),
        content_type: contentType,
        quantity: parseInt(quantity),
        revisions: parseInt(revisions),
        duration: `${duration1} ${duration2}`,
        price: parseFloat(price),
        currency: 'INR',
        status: 'active'
      }
    });

    res.json({
      success: true,
      message: 'Package created successfully',
      package
    });

  } catch (error) {
    console.error('Create package error:', error);
    res.status(500).json({ 
      error: 'Failed to create package',
      message: error.message 
    });
  }
});

// Create portfolio item (from CreatePortfolioScreen)
router.post('/create-portfolio', [
  body('mediaUrl').notEmpty().withMessage('Media URL is required'),
  body('mediaType').isIn(['image', 'video', 'archive', 'document']).withMessage('Valid media type required'),
  body('fileName').notEmpty().withMessage('File name is required'),
  body('fileSize').isInt({ min: 1 }).withMessage('Valid file size required'),
  body('mimeType').optional()
], validateRequest, authenticateToken, async (req, res) => {
  try {
    const { mediaUrl, mediaType, fileName, fileSize, mimeType } = req.body;
    const userId = BigInt(req.userId);

    // Get creator profile
    const creatorProfile = await prisma.creatorProfile.findUnique({
      where: { user_id: userId }
    });

    if (!creatorProfile) {
      return res.status(400).json({ error: 'Creator profile not found' });
    }

    // Create portfolio item
    const portfolioItem = await prisma.portfolioItem.create({
      data: {
        creator_id: creatorProfile.id,
        media_type: mediaType.toUpperCase(),
        media_url: mediaUrl,
        title: fileName,
        description: `Uploaded file: ${fileName}`,
        file_size: BigInt(fileSize),
        mime_type: mimeType || '',
        status: 'active'
      }
    });

    res.json({
      success: true,
      message: 'Portfolio item created successfully',
      portfolioItem
    });

  } catch (error) {
    console.error('Create portfolio error:', error);
    res.status(500).json({ 
      error: 'Failed to create portfolio item',
      message: error.message 
    });
  }
});

// Submit KYC (from KycModal)
router.post('/submit-kyc', [
  body('documentType').isIn(['aadhaar', 'pan']).withMessage('Valid document type required'),
  body('frontImageUrl').notEmpty().withMessage('Front image URL is required'),
  body('backImageUrl').notEmpty().withMessage('Back image URL is required')
], validateRequest, authenticateToken, async (req, res) => {
  try {
    const { documentType, frontImageUrl, backImageUrl } = req.body;
    const userId = BigInt(req.userId);

    // Get creator profile
    const creatorProfile = await prisma.creatorProfile.findUnique({
      where: { user_id: userId }
    });

    if (!creatorProfile) {
      return res.status(400).json({ error: 'Creator profile not found' });
    }

    // Create or update KYC
    const kyc = await prisma.kYC.upsert({
      where: { creator_id: creatorProfile.id },
      update: {
        document_type: documentType.toUpperCase(),
        document_front_url: frontImageUrl,
        document_back_url: backImageUrl,
        status: 'pending',
        submitted_at: new Date()
      },
      create: {
        creator_id: creatorProfile.id,
        document_type: documentType.toUpperCase(),
        document_front_url: frontImageUrl,
        document_back_url: backImageUrl,
        status: 'pending',
        submitted_at: new Date()
      }
    });

    res.json({
      success: true,
      message: 'KYC submitted successfully',
      kyc
    });

  } catch (error) {
    console.error('Submit KYC error:', error);
    res.status(500).json({ 
      error: 'Failed to submit KYC',
      message: error.message 
    });
  }
});

// Get user profile with all related data
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = BigInt(req.userId);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        creator_profile: {
          include: {
            kyc: true,
            portfolio_items: true,
            social_media_accounts: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ 
      error: 'Failed to get profile',
      message: error.message 
    });
  }
});

module.exports = router; 