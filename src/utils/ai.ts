import OpenAI from 'openai';
import { config } from 'dotenv';
import { getModel } from '../config/models.js';

config();

export async function createAI(modelName?: string) {
  const modelConfig = await getModel(modelName);
  if (!modelConfig) {
    throw new Error('No model configuration found');
  }

  return new OpenAI({
    baseURL: modelConfig.baseURL,
  });
}

export const openai = await createAI();
