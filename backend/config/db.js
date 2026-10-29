import mongoose from 'mongoose';

const MAX_CONNECT_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;

/**
 * Validates production environment variables.
 * Fails fast if required database configuration is absent.
 */
export function validateDatabaseEnv() {
  const isProduction = process.env.NODE_ENV === 'production';
  const mongoUri = process.env.MONGO_URI;

  if (isProduction) {
    if (!mongoUri) {
      throw new Error(
        '[FATAL] MONGO_URI environment variable is required in production mode. ' +
        'Silently falling back to localhost is strictly prohibited.'
      );
    }
    if (mongoUri.includes('127.0.0.1') || mongoUri.includes('localhost')) {
      console.warn(
        '[WARNING] Production mode is configured with a localhost/127.0.0.1 MongoDB URI. ' +
        'Ensure this matches your intended production deployment infrastructure.'
      );
    }
  }
}

/**
 * Connects to MongoDB with bounded exponential backoff retries.
 *
 * @param {number} [maxRetries=5]
 * @returns {Promise<mongoose.Connection>}
 */
export const connectDB = async (maxRetries = MAX_CONNECT_RETRIES) => {
  validateDatabaseEnv();

  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mern_dev_db';

  let attempt = 0;
  let delay = INITIAL_BACKOFF_MS;

  while (attempt < maxRetries) {
    attempt++;
    try {
      const conn = await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 5000,
      });

      console.log(
        `[MongoDB] Connected successfully to: ${conn.connection.host}/${conn.connection.name}`
      );
      return conn;
    } catch (error) {
      console.error(
        `[MongoDB] Connection attempt ${attempt}/${maxRetries} failed: ${error.message}`
      );

      if (attempt >= maxRetries) {
        if (process.env.NODE_ENV === 'production') {
          console.error('[MongoDB] All connection retries exhausted in production mode. Exiting.');
          process.exit(1);
        } else {
          console.warn('[MongoDB] Connection retries exhausted. API will operate in degraded mode until database is restored.');
          return null;
        }
      }

      console.log(`[MongoDB] Retrying connection in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
};

/**
 * Safely closes the MongoDB connection during graceful shutdown.
 */
export const closeDB = async () => {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
      console.log('[MongoDB] Connection closed safely.');
    }
  } catch (error) {
    console.error(`[MongoDB] Error closing connection: ${error.message}`);
  }
};

/**
 * Checks whether the active MongoDB connection supports multi-document transactions
 * (i.e. replica set or sharded cluster).
 *
 * @returns {boolean}
 */
export const supportsTransactions = () => {
  try {
    if (mongoose.connection.readyState !== 1) return false;
    const topology = mongoose.connection.client?.topology;
    const topologyType = topology?.description?.type;
    return (
      topologyType === 'ReplicaSetWithPrimary' ||
      topologyType === 'ReplicaSetNoPrimary' ||
      topologyType === 'Sharded'
    );
  } catch {
    return false;
  }
};
