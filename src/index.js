const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { startBot } = require('./bot');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Environment variable validation
if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error("BOT_TOKEN is not defined in the environment variables.");
    process.exit(1); // Exit the application if BOT_TOKEN is missing
}

// Enable GZIP compression for faster response times
app.use(compression());

// Use Helmet to set security-related HTTP headers
app.use(helmet());

// Rate limiting middleware for limiting requests per IP
/*const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // Limit each IP to 100 requests per windowMs
});
app.use(limiter);
*/
// Serve static files from the public directory
app.use(express.static('public'));

// Use express' built-in body parser
app.use(express.json());

// Start the Telegram bot
try {
    startBot();
    console.log("Bot started successfully.");
} catch (error) {
    console.error("Failed to start bot:", error);
}

// Start the web server
app.listen(PORT, (error) => {
    if (error) {
        console.error("Error starting server:", error);
    } else {
        console.log(`Server is running on http://localhost:${PORT}`);
    }
});

process.on('SIGINT', () => {
  console.log('Received SIGINT signal, shutting down gracefully...');
  // Close database connections, stop timers, etc.
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM signal, shutting down gracefully...');
  // Close database connections, stop timers, etc.
  process.exit(0);
});
