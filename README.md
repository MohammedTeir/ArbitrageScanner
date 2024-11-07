# Telegram Bot for Crypto Arbitrage Tracking

This project is a Telegram bot that allows users to track cryptocurrency prices, manage a watchlist, and receive real-time updates on specific coins. The bot uses MongoDB for data storage and leverages the CoinGecko API for cryptocurrency data.

## Features

- Set a target cryptocurrency (e.g., BTC, ETH) to track.
- Toggle tracking for the top 100 coins.
- Start or pause data fetching.
- Manage custom whitelists and blacklists of coin IDs for targeted tracking.
- View a list of whitelisted or blacklisted coins.
- Real-time notifications for significant price movements.

## Getting Started

### Prerequisites

Ensure you have the following installed:

- **Node.js** (version 18 or later)
- **MongoDB** (version 6.10.0 or later)

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/MohammedTeir/ArbitrageScanner.git
   cd ArbitrageScanner

2. Install the dependencies:

npm install


3. Create a .env file at the root of your project with the following keys:

TELEGRAM_BOT_TOKEN=your-telegram-bot-token
MONGODB_URI=your-mongodb-uri
COINGECKO_API_KEY=your-coingecko-api-key
PROFIT_THRESHOLD=2
VOLUME_THRESHOLD=1000
TARGET_CURRENCY=USDT
DB_NAME=arbitrageScanner
PORT=8080

Environment Variables Explained:

TELEGRAM_BOT_TOKEN: Your Telegram bot token provided by BotFather.

MONGODB_URI: Connection string for your MongoDB database.

COINGECKO_API_KEY: Your API key for accessing the CoinGecko API.

PROFIT_THRESHOLD: Minimum profit percentage to trigger notifications (default: 2%).

VOLUME_THRESHOLD: Minimum trading volume to trigger notifications (default: 1000).

TARGET_CURRENCY: The cryptocurrency you want to track (default: USDT).

DB_NAME: Name of the MongoDB database (default: arbitrageScanner).

PORT: The port on which the server will run (default: 8080).




Dependencies

The project relies on the following packages:

@types/node: Provides TypeScript definitions for Node.js.

axios: Used for making HTTP requests to fetch cryptocurrency data.

compression: Middleware to compress HTTP responses for faster performance.

dotenv: Manages environment variables securely.

express: Sets up a lightweight server for handling requests.

mongodb: Enables MongoDB interactions.

node-telegram-bot-api: Provides Telegram Bot API methods for interaction with users.


Usage

1. Start MongoDB if it's not already running:

mongod


2. Start the bot:

npm start


3. Open Telegram, find your bot, and start sending commands.



Available Commands

/set_target: Set the target cryptocurrency to track (e.g., BTC, ETH).

/toggle_top100: Enable or disable tracking for the top 100 coins.

/toggle_fetching: Start or pause data fetching.

/add_coin_id: Add a specific coin to your whitelist.

/remove_coin_id: Remove a coin from your whitelist.

/view_whitelist: View all coins in your whitelist.

/add_blacklist: Add a specific coin to your blacklist to avoid tracking.

/remove_blacklist: Remove a coin from your blacklist.

/view_blacklist: View all coins in your blacklist.


Sample Callback Handling

To refresh inline buttons after a callback, you can use bot.editMessageReplyMarkup to resend the updated inline keyboard with the latest options.

// Example Callback Handling
bot.on('callback_query', async (query) => {
  const { data, message } = query;
  const chatId = message.chat.id;

  // Example actions for toggling top 100 feature
  if (data === 'toggle_top100') {
    const options = await getOptions(chatId);
    await bot.editMessageReplyMarkup(options.reply_markup, {
      chat_id: chatId,
      message_id: message.message_id
    });
  }
});

Notes

Environment Variables: Use the .env file for storing sensitive data, like the bot token and MongoDB URI.

Data Storage: MongoDB stores user data, including the target cryptocurrency, watchlist, and blacklist.


Contributing

1. Fork the project.


2. Create a new branch (feature/YourFeature).


3. Commit your changes.


4. Push to the branch.


5. Open a pull request.



License

This project is licensed under the MIT License.

Contact

Author: Mohammed Abu Teir
Email: moh2015moh21415@gmail.com

### Key Updates:
- Added detailed descriptions for the new environment variables, helping users understand their purpose.
- Maintained the same structured format for clarity and ease of navigation.

