const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const { MongoClient } = require("mongodb");

// Load environment variables
require("dotenv").config();

// Access environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
const PROFIT_THRESHOLD = parseFloat(process.env.PROFIT_THRESHOLD);
const VOLUME_THRESHOLD = parseInt(process.env.VOLUME_THRESHOLD, 10);
const TARGET_CURRENCY = process.env.TARGET_CURRENCY;
const DB_NAME = process.env.DB_NAME;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// User state tracking
const userState = {};

// MongoDB setup
let db;

// Connect to MongoDB
async function connectToMongo() {
  try {
    console.log("Connecting to MongoDB...");
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);
    console.log("Connected to MongoDB");

    // After connecting, check or create required collections
    await checkAndCreateUserCollection();
    await checkAndCreateTop100CoinsCollection();

  } catch (error) {
    console.error("Error connecting to MongoDB:", error.message);
    throw error;
  }
}

startBot()

// Send a message with error handling and notification to user
async function sendTelegramMessage(chatId, message) {
  if (!chatId) {
    console.error("chat_id is empty or undefined", chatId);
    return;
  }
  try {
    const msg = await bot.sendMessage(chatId, message);
    return msg;
  } catch (error) {
    console.error(`Error sending message to ${chatId}:`, error.message);
    // Notify user of the failure
    try {
      await bot.sendMessage(
        chatId,
        "There was an error sending your message. Please try again later.",
      );
    } catch (notificationError) {
      console.error(
        `Error notifying user of message failure: ${notificationError.message}`,
      );
    }
  }
}

// Fetch coin data including tickers for a specific coin ID

async function fetchCoinData(coinId, chatId) {
  // Check if fetching is paused in the database
  const userData = await db.collection("users").findOne({ telegramId: chatId }); // Retrieve user data by chatId
  const isPaused = userData?.isPaused || false; // Default to false if no value found

  if (isPaused) {
    return null; // Exit the function if paused
  }

  // If not paused, proceed with data fetching
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/tickers`;
  const options = {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-cg-demo-api-key": COINGECKO_API_KEY, // Replace with your actual API key if necessary
    },
  };

  try {
    const response = await axios.get(url, options);
    //console.log(`Response for ${coinId}:`, response.data); // Log the response
    return response; // Return the array
  } catch (error) {
    return null;
  }
}

// Format number with commas and currency symbol
function formatVolume(volume) {
  return `$${volume.toLocaleString()}`;
}

async function updateUserTarget(chatId, target) {
  try {
    // Update or add the target field in the user's document
    await db
      .collection("users")
      .updateOne(
        { telegramId: chatId },
        { $set: { target } },
        { upsert: true },
      );
  } catch (error) {
    return null;
  }
}

// Function to check arbitrage opportunities using converted_last.usd for specific pairs with USDT as target
async function checkArbitrage(tickers, chatId) {
  if (!tickers || tickers.length === 0) {
    return null; // Ensure tickers is not null or empty
  }

  const user = await db.collection("users").findOne({ telegramId: chatId });

  const minProfit = user?.minProfit || PROFIT_THRESHOLD; // Use stored decimal value
  const minVolume = user?.minVolume || VOLUME_THRESHOLD;

  const blacklistIds = user?.blacklistIds || []; // Fetch blacklisted IDs
  let minPriceTicker = null;
  let maxPriceTicker = null;

  tickers.forEach((ticker) => {
    if (
      ticker.target === user.target &&
      ticker.volume >= minVolume &&
      ticker.trust_score
      &&
      !blacklistIds.includes(ticker.base.toLowerCase()) // Exclude blacklisted IDs

    ) {
      const priceUSD = ticker.converted_last?.usd;

      if (priceUSD) {
        if (!minPriceTicker || priceUSD < minPriceTicker.converted_last.usd) {
          minPriceTicker = ticker;
        }
        if (!maxPriceTicker || priceUSD > maxPriceTicker.converted_last.usd) {
          maxPriceTicker = ticker;
        }
      }
    }
  });

  if (minPriceTicker && maxPriceTicker) {
    let potentialProfitPercent = (
      ((maxPriceTicker.converted_last.usd - minPriceTicker.converted_last.usd) /
        minPriceTicker.converted_last.usd) *
      100
    ).toFixed(2);

    if (potentialProfitPercent < minProfit * 100) return null;

    // Trust score indicator
    const trustScoreEmojis = {
      green: "🟢",
      yellow: "🟡",
      red: "🔴",
    };
    let trustScoreEmoji = trustScoreEmojis[minPriceTicker.trust_score] || "";

    return {
      coinPair: `${minPriceTicker.base}/${minPriceTicker.target}`,
      lowestPrice: minPriceTicker.converted_last.usd,
      lowestExchange: minPriceTicker.market.name,
      highestPrice: maxPriceTicker.converted_last.usd,
      highestExchange: maxPriceTicker.market.name,
      volume: formatVolume(minPriceTicker.converted_volume.usd),
      lowestExchangeUrl: minPriceTicker.trade_url,
      highestExchangeUrl: maxPriceTicker.trade_url,
      trustScore: trustScoreEmoji,
      potentialProfit: potentialProfitPercent,
    };
  }
  return null;
}

// Function to delete a message after a timeout
async function deleteMessage(chatId, messageId, timeout) {
  setTimeout(() => {
    bot
      .deleteMessage(chatId, messageId)
      .catch((err) =>
        console.error(`Failed to delete message: ${err.message}`),
      );
  }, timeout);
}

// Assuming user settings are retrieved from MongoDB
async function getOptions(chatId) {

 if (!db) {
    console.error("Database not connected");
    return null;
  }
  
  const userSettings = await db
    .collection("users")
    .findOne({ telegramId: chatId });

  const minProfit = userSettings?.minProfit || PROFIT_THRESHOLD;
  const minVolume = userSettings?.minVolume || VOLUME_THRESHOLD;
  const target = userSettings?.target || "USDT";
  const isTop100 = userSettings?.isTop100 ? "ON" : "OFF";
  const isPaused = userSettings?.isPaused ? "Paused" : "Active";

  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "➕Add to Whitelist", callback_data: "add_coin_id" },
          { text: "➖Remove from Whitelist", callback_data: "remove_coin_id" },
        ],
        [
         { text: "➕Add to Blacklist", callback_data: "add_blacklist_id" },
  { text: "➖Remove from Blacklist", callback_data: "remove_blacklist_id" },
],
[
           {
            text: "📄View Whitelisted IDs",
            callback_data: "view_whitelist",
          },
  { text: "📄View Blacklisted IDs", callback_data: "view_blacklist" }
],
        [
          {
            text: `💸Set Min Profit: ${minProfit}%`,
            callback_data: "set_min_profit",
          },
          { text: `🎯Set Target: ${target}`, callback_data: "set_target" }

        ],
        [{
            text: `🔉Set Min Volume: ${minVolume}`,
            callback_data: "set_min_volume",
          }],
        [
          {
            text: `📈Top 100 Coins (Vol): ${isTop100}`,
            callback_data: "toggle_top100",
          },
        ],
        [{ text: `⏸️${isPaused}`, callback_data: "toggle_fetching" }],
      ],
    },
  };
}

// Function to handle the /start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat && msg.chat.id; // Ensure chatId is defined

  if (!chatId) {
    return;
  }

  try {
    const existingUser = await db
      .collection("users")
      .findOne({ telegramId: chatId });

    if (!existingUser) {
      // If not, create a new user
      await db
        .collection("users")
        .insertOne({
          telegramId: chatId,
          whitelistIds: [],
          blacklistIds: [],
          isPaused: false,
          minProfit: PROFIT_THRESHOLD,
          minVolume: VOLUME_THRESHOLD,
          isTop100: false,
          target: "USDT",
        });
      const welcomeMessage = await sendTelegramMessage(
        chatId,
        "Welcome to the Arbitrage Bot! You can start by adding trading pairs to your whitelist.",
      );
      deleteMessage(chatId, welcomeMessage.message_id, 5000);
    } else {
      const welcomeBackMessage = await sendTelegramMessage(
        chatId,
        "Welcome back to the Arbitrage Bot! You can check your coins ids.",
      );
      deleteMessage(chatId, welcomeBackMessage.message_id, 5000);
    }

    const options = await getOptions(chatId);

    await bot.sendMessage(chatId, "Choose an option below:", options);
  } catch (error) {
    await sendTelegramMessage(
      chatId,
      "There was an error processing your request.",
    );
  }
});

//Implement the /options Command

bot.onText(/\/options/, async (msg) => {
  const chatId = msg.chat.id;

  const options = await getOptions(chatId);
  await bot.sendMessage(chatId, "Choose an option below:", options);
});


//Implement the /resume and /pause Commands

bot.onText(/\/resume/, async (msg) => {
  const chatId = msg.chat.id;

  await db.collection("users").updateOne({ telegramId: chatId }, { $set: { isPaused: false } });
  await sendTelegramMessage(chatId, "Fetching data has been resumed.");
});

bot.onText(/\/pause/, async (msg) => {
  const chatId = msg.chat.id;

  await db.collection("users").updateOne({ telegramId: chatId }, { $set: { isPaused: true } });
  await sendTelegramMessage(chatId, "Fetching data has been paused.");
});

//Implement the /top100start and /top100stop Commands

bot.onText(/\/top100enable/, async (msg) => {
  const chatId = msg.chat.id;

  await db.collection("users").updateOne({ telegramId: chatId }, { $set: { isTop100: true } });
  await sendTelegramMessage(chatId, "Top 100 coins feature has been enabled.");
});

bot.onText(/\/top100disable/, async (msg) => {
  const chatId = msg.chat.id;

  await db.collection("users").updateOne({ telegramId: chatId }, { $set: { isTop100: false } });
  await sendTelegramMessage(chatId, "Top 100 coins feature has been disabled.");
});


// Handle button presses for adding, removing, and viewing coin ids

bot.on("callback_query", async (query) => {
  const { data, message } = query;
  const chatId = message.chat.id;

  if (data === "set_target") {
    // Prompt user to enter the target using sendTelegramMessage
    await sendTelegramMessage(
      chatId,
      "Please enter the target (e.g., USDT, BTC, ETH):",
    );

    // Wait for user input
    bot.once("message", async (msg) => {
      const target = msg.text.trim().toUpperCase();

      // Validate the target input
      if (!target || target.length > 5) {
        // Limit target length for safety
        return await sendTelegramMessage(
          chatId,
          "Invalid target. Please enter a valid target (e.g., USDT, BTC, ETH).",
        );
      }

      // Update the user's document in MongoDB with the new target
      await updateUserTarget(chatId, target);

      const options = await getOptions(chatId);
      await bot.editMessageReplyMarkup(options.reply_markup, {
        chat_id: chatId,
        message_id: message.message_id,
      });

      // Confirmation message
      setTargetMessage = await sendTelegramMessage(
        chatId,
        `Target set to ${target} successfully.`,
      );
      deleteMessage(chatId, setTargetMessage.message_id, 5000);
    });
  }

  if (data === "toggle_top100") {
    const user = await db.collection("users").findOne({ telegramId: chatId });
    const newTop100State = !user.isTop100;
    await db
      .collection("users")
      .updateOne(
        { telegramId: chatId },
        { $set: { isTop100: newTop100State } },
      );
    const options = await getOptions(chatId);
    await bot.editMessageReplyMarkup(options.reply_markup, {
      chat_id: chatId,
      message_id: message.message_id,
    });

    const stateMessage = newTop100State ? "enabled" : "disabled";
    top100Message = await sendTelegramMessage(
      chatId,
      `Top 100 coins feature has been ${stateMessage}.`,
    );
    deleteMessage(chatId, top100Message.message_id, 20000);
  }

  if (data === "toggle_fetching") {
    // Fetch the current state from the database
    const user = await db.collection("users").findOne({ telegramId: chatId });
    if (user) {
      // Toggle the state
      const newFetchingState = !user.isPaused;

      // Update the user's fetching state in the database
      await db
        .collection("users")
        .updateOne(
          { telegramId: chatId },
          { $set: { isPaused: newFetchingState } },
        );
      // Handle other callback data (like set_min_profit, etc.)

      const options = await getOptions(chatId);
      await bot.editMessageReplyMarkup(options.reply_markup, {
        chat_id: chatId,
        message_id: message.message_id,
      });

      // Send a message with the updated state
      const stateMessage = newFetchingState ? "paused" : "resumed";

      fetchingDataState = await sendTelegramMessage(
        chatId,
        `Fetching data has been ${stateMessage}.`,
      );
      deleteMessage(chatId, fetchingDataState.message_id, 20000);
      // Update button display with the new state
    } else {
      // If the user document is missing, insert it with default values
      await db
        .collection("users")
        .insertOne({
          telegramId: chatId,
          whitelistIds: [],
          blacklistIds: [],
          isPaused: false,
          minProfit: PROFIT_THRESHOLD,
          minVolume: VOLUME_THRESHOLD,
          isTop100: false,
          target: "USDT",
        });
    }
  }

  if (data === "add_coin_id") {
    userState[chatId] = "adding_to_whitelist";
    await sendTelegramMessage(
      chatId,
      "Please send the coin ID you want to add.",
    );
  } else if (data === "remove_coin_id") {
    userState[chatId] = "removing_from_whitelist";
    await sendTelegramMessage(
      chatId,
      "Please send the coin ID you want to remove.",
    );
  } else if (data === "view_whitelist") {
    const user = await db.collection("users").findOne({ telegramId: chatId });
    if (user) {
      const whitelistIds =
        user.whitelistIds.length > 0
          ? user.whitelistIds.join(", ")
          : "No whitelisted coin IDs.";
      await sendTelegramMessage(
        chatId,
        `Your whitelisted coin IDs: ${whitelistIds}`,
      );
    } else {
      await sendTelegramMessage(
        chatId,
        "You have no whitelisted coin IDs yet.",
      );
    }
  } else if (data === "add_blacklist_id") {
    userState[chatId] = "adding_to_blacklist";
    await sendTelegramMessage(
      chatId,
      "Please enter the Coin ID you want to blacklist:",
    );

  }else if (data === "remove_blacklist_id") {
    userState[chatId] = "removing_from_blacklist";
    await sendTelegramMessage(
      chatId,
      "Please enter the Coin ID you want to remove from the blacklist:",
    );
  }else if (data === "view_blacklist") {
    const user = await db.collection("users").findOne({ telegramId: chatId });
    const blacklistIds = user?.blacklistIds || [];

    const message = blacklistIds.length > 0
      ? `Your blacklisted IDs: ${blacklistIds.join(", ")}`
      : "Your blacklist is empty.";

   await sendTelegramMessage(chatId, message);

  }else if (data === 'set_min_profit') {
    const promptMessage = await sendTelegramMessage(chatId, 'Please send the minimum potential profit percentage (e.g., 2 for 2%).');

    bot.once('message', async (msg) => {
        const minProfitPercentage = parseFloat(msg.text);

        if (isNaN(minProfitPercentage) || minProfitPercentage <= 0) {
            await sendTelegramMessage(chatId, 'Please enter a valid profit percentage greater than 0.');
            // Delete the prompt message after a certain time (e.g., 10 seconds)
            await deleteMessage(chatId, promptMessage.message_id, 10000);
        } else {
            const minProfit = minProfitPercentage / 100;

            try {
                await db.collection('users').updateOne({ telegramId: chatId }, { $set: { minProfit: minProfit } });

                const options = await getOptions(chatId);
                await bot.editMessageReplyMarkup(options.reply_markup, {
                    chat_id: chatId,
                    message_id: message.message_id
                });

                const confirmationMessage = await sendTelegramMessage(chatId, `Minimum profit percentage set to ${minProfitPercentage}%.`);
                // Delete the prompt and confirmation messages after a certain time (e.g., 10 seconds)
                await deleteMessage(chatId, promptMessage.message_id, 10000);
                await deleteMessage(chatId, confirmationMessage.message_id, 10000);
            } catch (error) {
                await sendTelegramMessage(chatId, 'There was an error saving the minimum profit. Please try again.');
                await deleteMessage(chatId, promptMessage.message_id, 10000);
            }
            }
    });


   } else if (data === 'set_min_volume') {
    const volumePrompt = await sendTelegramMessage(chatId, 'Please send the minimum 24h volume (e.g., 1000).');

    bot.once('message', async (msg) => {
        const minVolume = parseInt(msg.text, 10);

        if (isNaN(minVolume) || minVolume <= 0) {
            await sendTelegramMessage(chatId, 'Please enter a valid volume greater than 0.');
            await deleteMessage(chatId, volumePrompt.message_id, 10000); // Delete prompt after 10 seconds
        } else {
            try {
                await db.collection('users').updateOne({ telegramId: chatId }, { $set: { minVolume: minVolume } });

                const options = await getOptions(chatId);
                await bot.editMessageReplyMarkup(options.reply_markup, {
                    chat_id: chatId,
                    message_id: message.message_id
                });

                const volumeConfirmation = await sendTelegramMessage(chatId, `Minimum 24h volume set to ${minVolume}.`);
                await deleteMessage(chatId, volumePrompt.message_id, 10000); // Delete prompt after 10 seconds
                await deleteMessage(chatId, volumeConfirmation.message_id, 10000); // Delete confirmation after 10 seconds
            } catch (error) {
                await sendTelegramMessage(chatId, 'There was an error saving the minimum volume. Please try again.');
                await deleteMessage(chatId, volumePrompt.message_id, 10000); // Delete prompt after 10 seconds
            }
        }
    });
}



});

// Listener for user messages to handle adding and removing coin IDs

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

// Check if the user is in a specific state
if (userState[chatId] === "adding_to_whitelist") {
  const coinIdToAdd = msg.text.trim();

  try {
    // Check if coinIdToAdd is already in the user's whitelist
    const user = await db.collection("users").findOne({ telegramId: chatId });
    if (user && user.whitelistIds.includes(coinIdToAdd)) {
      await sendTelegramMessage(chatId, `Coin ID ${coinIdToAdd} is already in your whitelist.`);
    } else {
      await db.collection("users").updateOne(
        { telegramId: chatId },
        { $addToSet: { whitelistIds: coinIdToAdd } }
      );
      await sendTelegramMessage(chatId, `Coin ID ${coinIdToAdd} has been added to your whitelist.`);
    }
  } catch (error) {
    await sendTelegramMessage(chatId, "There was an error adding the coin ID. Please try again.");
  }

  // Reset the user's state
  delete userState[chatId];
} else if (userState[chatId] === "removing_from_whitelist") {
  const coinIdToRemove = msg.text.trim();

  try {
    // Check if coinIdToRemove is in the user's whitelist
    const user = await db.collection("users").findOne({ telegramId: chatId });
    if (user && user.whitelistIds.includes(coinIdToRemove)) {
      await db.collection("users").updateOne(
        { telegramId: chatId },
        { $pull: { whitelistIds: coinIdToRemove } }
      );
      await sendTelegramMessage(chatId, `Coin ID ${coinIdToRemove} has been removed from your whitelist.`);
    } else {
      await sendTelegramMessage(chatId, `Coin ID ${coinIdToRemove} is not in your whitelist.`);
    }
  } catch (error) {
    await sendTelegramMessage(chatId, "There was an error removing the coin ID. Please try again.");
  }

  // Reset the user's state
  delete userState[chatId];
}

if (userState[chatId] === "adding_to_blacklist") {
  const blacklistId = msg.text.trim().toLowerCase();

  try {
    // Check if blacklistId is already in the user's blacklist
    const user = await db.collection("users").findOne({ telegramId: chatId });
    if (user && user.blacklistIds.includes(blacklistId)) {
      await sendTelegramMessage(chatId, `${blacklistId} is already in your blacklist.`);
    } else {
      await db.collection("users").updateOne(
        { telegramId: chatId },
        { $addToSet: { blacklistIds: blacklistId } }
      );
      await sendTelegramMessage(chatId, `${blacklistId} has been added to your blacklist.`);
    }
  } catch (error) {
    await sendTelegramMessage(chatId, "There was an error adding the coin ID to the blacklist. Please try again.");
  }

  delete userState[chatId];
} else if (userState[chatId] === "removing_from_blacklist") {
  const blacklistId = msg.text.trim().toLowerCase();

  try {
    // Check if blacklistId is in the user's blacklist
    const user = await db.collection("users").findOne({ telegramId: chatId });
    if (user && user.blacklistIds.includes(blacklistId)) {
      await db.collection("users").updateOne(
        { telegramId: chatId },
        { $pull: { blacklistIds: blacklistId } }
      );
      await sendTelegramMessage(chatId, `${blacklistId} has been removed from your blacklist.`);
    } else {
      await sendTelegramMessage(chatId, `${blacklistId} is not in your blacklist.`);
    }
  } catch (error) {
    await sendTelegramMessage(chatId, "There was an error removing the coin ID from the blacklist. Please try again.");
  }

  delete userState[chatId];
}

});

async function checkUserArbitrage(coinId, chatId) {
  const coinData = await fetchCoinData(coinId, chatId);

  if (!coinData) {
    return null;
  }

  const arbitrageOpportunity = await checkArbitrage(
    coinData.data.tickers,
    chatId,
  );

  if (arbitrageOpportunity) {
    return (
      `💰 <b>Arbitrage Opportunity Found:</b>\n` +
      `🪙 <b>Coin:</b> <b>${coinData.data.name}</b>\n` +
      `🖇️ <b>Coin Pair:</b> ${arbitrageOpportunity.coinPair}\n` +
      `📉 <b>Buy Price:</b> <i>$${arbitrageOpportunity.lowestPrice}</i> on <a href="${arbitrageOpportunity.lowestExchangeUrl}">${arbitrageOpportunity.lowestExchange}</a>\n` +
      `📈 <b>Sell Price:</b> <i>$${arbitrageOpportunity.highestPrice}</i> on <a href="${arbitrageOpportunity.highestExchangeUrl}">${arbitrageOpportunity.highestExchange}</a>\n` +
      `💵 <b>24h Volume:</b> ${arbitrageOpportunity.volume}\n` +
      `📊 <b>Potential Profit:</b> <u>${arbitrageOpportunity.potentialProfit}%</u>\n` +
      `🔒 <b>Trust Score:</b> ${arbitrageOpportunity.trustScore}`
    );
} else {
    return null;
}
}

// Function to check arbitrage for all users
async function checkAllUsersArbitrage() {
  try {
    // Fetch top 100 coins from the top100coins collection
    const top100Coins = await db.collection("top100coins").find().toArray();
    const top100coinsIds = top100Coins.map((coin) => coin.id);

    const users = await db.collection("users").find().toArray();

    for (const user of users) {
      const { telegramId, whitelistIds, isTop100 } = user;

      const coinIds = isTop100 ? top100coinsIds : whitelistIds;

      for (const coinId of coinIds) {
        const message = await checkUserArbitrage(coinId, telegramId);
        // Only send a message if there's a valid arbitrage opportunity
        if (message) {
          await bot.sendMessage(telegramId, message, { parse_mode: "HTML" });
        }
      }
    }
  } catch (error) {
    console.error("Error checking arbitrage for all users:", error.message);
  }
}

// Function to check and create the top100coins collection
async function checkAndCreateTop100CoinsCollection() {
  const collectionName = "top100coins";
  const collections = await db.listCollections().toArray();

  // Check if the collection exists
  const collectionExists = collections.some(
    (collection) => collection.name === collectionName,
  );

  if (!collectionExists) {
    console.log(
      `Collection ${collectionName} does not exist. Creating and populating it.`,
    );

    // Fetch data from CoinGecko API
    await fetchAndInsertTop100Coins();
  } else {
    console.log(`Collection ${collectionName} already exists.`);
  }
}

// Function to fetch and insert top 100 coins into the collection
async function fetchAndInsertTop100Coins() {
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=100&page=1&precision=full`;
  const options = {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-cg-demo-api-key": COINGECKO_API_KEY, // Replace with your actual API key if necessary
    },
  };

  try {
    const response = await axios.get(url, options);
    const top100Coins = response.data.map((coin) => ({
      id: coin.id,
      name: coin.name,
      symbol: coin.symbol,
      market_cap: coin.market_cap,
      last_updated: coin.last_updated,
    }));

    // Create the collection and insert the data
    await db.createCollection("top100coins");
    await db.collection("top100coins").insertMany(top100Coins);
    console.log(
      `${top100Coins.length} coins inserted into top100coins collection.`,
    );
  } catch (apiError) {
    console.error(
      "Error fetching top 100 coins from CoinGecko:",
      apiError.message,
    );
  }
}

async function updateTop100Coins() {
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=100&page=1&precision=full`;
  const options = {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-cg-demo-api-key": COINGECKO_API_KEY, // Replace with your actual API key if necessary
    },
  };

  try {
    const response = await axios.get(url, options);
    const top100Coins = response.data.map((coin) => ({
      id: coin.id,
      name: coin.name,
      symbol: coin.symbol,
      market_cap: coin.market_cap,
      last_updated: coin.last_updated,
    }));

    // Clear the existing collection
    await db.collection("top100coins").deleteMany({}); // Remove all documents

    // Insert the new data
    await db.collection("top100coins").insertMany(top100Coins);
    console.log(
      `Top 100 coins updated in the collection. ${top100Coins.length} coins inserted.`,
    );
  } catch (apiError) {
    console.error(
      "Error fetching top 100 coins from CoinGecko for update:",
      apiError.message,
    );
  }
}

async function checkAndCreateUserCollection() {
  try {
    const collections = await db.listCollections({ name: 'users' }).toArray();
    if (collections.length === 0) {
      // If 'users' collection does not exist, create it with an index on telegramId
      await db.createCollection('users');
      await db.collection('users').createIndex({ telegramId: 1 }, { unique: true });
      console.log("Created 'users' collection with unique index on telegramId.");
    } else {
      console.log("'users' collection already exists.");
    }
  } catch (error) {
    console.error("Error checking/creating 'users' collection:", error.message);
  }
}

// Start the bot and the MongoDB connection
async function startBot() {
  await connectToMongo().catch((error) => {
  console.error("Error connecting to MongoDB:", error.message);
})
 // Check and create collections if they do not exist
  
  // Schedule to update the top 100 coins every hour
  setInterval(updateTop100Coins, 60 * 60 * 1000); // Update every hour

  // Check for arbitrage opportunities every minute (60000 milliseconds)
  setInterval(checkAllUsersArbitrage, 10000);
  console.log("Arbitrage bot is running...");
}




setInterval(() => {
  const memoryUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  // Memory levels
  const rssMb = memoryUsage.rss / 1024 / 1024;
  const heapTotalMb = memoryUsage.heapTotal / 1024 / 1024;
  const heapUsedMb = memoryUsage.heapUsed / 1024 / 1024;
  const externalMb = memoryUsage.external / 1024 / 1024;

  const rssLevel = rssMb > 100 ? 'High' : rssMb > 50 ? 'Medium' : 'Low';
  const heapUsedLevel = heapUsedMb > (heapTotalMb * 0.8) ? 'High' : heapUsedMb > (heapTotalMb * 0.5) ? 'Medium' : 'Low';

  // CPU levels
  const cpuUserMs = cpuUsage.user / 1000;
  const cpuSystemMs = cpuUsage.system / 1000;
  const cpuLevel = (cpuUserMs + cpuSystemMs) > 200 ? 'High' : (cpuUserMs + cpuSystemMs) > 100 ? 'Medium' : 'Low';

  console.log('--- Memory Usage ---');
  console.log(`RSS: ${rssMb.toFixed(2)} MB (Level: ${rssLevel})`);
  console.log(`Heap Total: ${heapTotalMb.toFixed(2)} MB`);
  console.log(`Heap Used: ${heapUsedMb.toFixed(2)} MB (Level: ${heapUsedLevel})`);
  console.log(`External: ${externalMb.toFixed(2)} MB`);

  console.log('--- CPU Usage ---');
  console.log(`CPU Usage (user): ${cpuUserMs.toFixed(2)} ms`);
  console.log(`CPU Usage (system): ${cpuSystemMs.toFixed(2)} ms`);
  console.log(`Overall CPU Level: ${cpuLevel}`);

},10000); // Log every 10 seconds

/*
module.exports = {
  startBot,
};
*/