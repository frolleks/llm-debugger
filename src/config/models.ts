import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.llm-debugger');
const CONFIG_FILE = path.join(CONFIG_DIR, 'models.json');

interface ModelConfig {
  name: string;
  baseURL: string;
  isDefault?: boolean;
}

export async function initConfig() {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    try {
      await fs.access(CONFIG_FILE);
    } catch {
      await fs.writeFile(CONFIG_FILE, JSON.stringify({ models: [] }));
    }
  } catch (err) {
    console.error('Failed to initialize config:', err);
  }
}

export async function saveModel(
  name: string,
  baseURL: string,
  setDefault = false
) {
  const config = await loadConfig();

  if (setDefault) {
    config.models = config.models.map((m: any) => ({ ...m, isDefault: false }));
  }

  const modelIndex = config.models.findIndex((m: any) => m.name === name);
  const modelConfig: ModelConfig = { name, baseURL, isDefault: setDefault };

  if (modelIndex >= 0) {
    config.models[modelIndex] = modelConfig;
  } else {
    config.models.push(modelConfig);
  }

  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { models: [] };
  }
}

export async function getModel(name?: string) {
  const config = await loadConfig();
  if (!name) {
    // Return default model if exists
    const defaultModel = (Object.values(config.models) as ModelConfig[]).find(
      (model) => model.isDefault
    );
    return defaultModel || null;
  }
  return config.models[name] || null;
}
