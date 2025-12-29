import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  ALLOWED_USER_IDS: (process.env.ALLOWED_USER_IDS || '').split(',').map(id => id.trim()),
  DATABASE_URL: process.env.DATABASE_URL || '',
  PORT: process.env.PORT || 10000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  WEBHOOK_URL: process.env.WEBHOOK_URL || '',
};

export const USER_IDS = {
  BRYAN: '109284773',
  HWEI_YEEN: '424894363',
};

export const USER_NAMES: { [key: string]: string } = {
  [USER_IDS.BRYAN]: 'Bryan',
  [USER_IDS.HWEI_YEEN]: 'Hwei Yeen',
};

export const BOT_USERS = [
  { id: BigInt(USER_IDS.BRYAN), name: 'Bryan', role: 'Bryan' },
  { id: BigInt(USER_IDS.HWEI_YEEN), name: 'Hwei Yeen', role: 'HweiYeen' },
];

