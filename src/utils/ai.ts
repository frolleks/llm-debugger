import OpenAI from 'openai';
import { config } from 'dotenv';

config();

export const openai = new OpenAI({
  // WIP: make this configurable
  baseURL: 'https://openrouter.ai/api/v1',
});
