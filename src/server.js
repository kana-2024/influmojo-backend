const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
// Load environment variables
try {
  require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
} catch (error) {
  console.log('dotenv not available, using default values');
}

const { PrismaClient } = require('./generated/client');

// Import routes
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

// Trust proxy for ngrok
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(cors({
  origin: [
    'http://localhost:3000', 
    'http://192.168.31.75:3000', 
    'http://192.168.31.57:3000',
    'http://192.168.31.57:3002',
    'exp://192.168.31.75:8081',
    'exp://192.168.31.57:8081',
    'http://localhost:8081',
    'exp://localhost:8081'
  ],
  credentials: true
}));
app.use(morgan('combined'));
app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Influ Mojo API is running',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Database connection and server start
async function startServer() {
  try {
    await prisma.$connect();
    console.log('✅ Database connected successfully');
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📱 Health check: http://localhost:${PORT}/api/health`);
      console.log(`📱 Network access: http://192.168.31.57:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down server...');
  await prisma.$disconnect();
  process.exit(0);
});

startServer(); 