import OpenAI from 'openai';
import { config } from 'dotenv';

config();

export const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
});
