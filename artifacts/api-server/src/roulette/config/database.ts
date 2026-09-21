import mongoose from 'mongoose';
import { env } from './env';
import { logger } from './logger';

let isConnected = false;

export async function connectDatabase(): Promise<void> {
  if (isConnected) return;

  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => {
    isConnected = true;
    logger.info('✅ MongoDB connected');
  });

  mongoose.connection.on('error', () => {
    logger.error('MongoDB connection error; check database access and credentials');
  });

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    logger.warn('⚠️ MongoDB disconnected, will retry via driver reconnection');
  });

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
    autoIndex: false,
    autoCreate: false,
  });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  isConnected = false;
}
