#!/usr/bin/env node

import { Command } from 'commander';
import { debuggerClient } from '../utils/debuggerClient.js';
import { initConfig, saveModel, loadConfig } from '../config/models.js';

const program = new Command();

// Initialize config on startup
await initConfig();

program
  .name('llm-debugger')
  .version('0.0.0')
  .description('A client for connecting an LLM with the Node.js debugger');

program
  .command('start')
  .description('Starts the LLM to debug')
  .option('-m, --model <name>', 'Specify model to use')
  .action(async (options) => {
    await debuggerClient(options.model);
  });

program
  .command('model:add')
  .description('Add or update a model configuration')
  .argument('<name>', 'Name of the model')
  .argument('<baseURL>', 'Base URL for the model API')
  .option('-d, --default', 'Set as default model')
  .action(async (name, baseURL, options) => {
    await saveModel(name, baseURL, options.default);
    console.log(`Model ${name} saved${options.default ? ' as default' : ''}`);
  });

program
  .command('model:list')
  .description('List all configured models')
  .action(async () => {
    const config = await loadConfig();
    console.table(config.models);
  });

program.parse(process.argv);
