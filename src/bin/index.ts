#!/usr/bin/env node

import { Command } from 'commander';
import { debuggerClient } from '../utils/debuggerClient.js';

const program = new Command();

program
  .name('llm-debugger')
  .version('0.0.0')
  .description('A client for connecting an LLM with the Node.js debugger');

program
  .command('start')
  .description(
    'Starts the LLM to debug. Requires a Node.js inspector server running.'
  )
  .action(debuggerClient);

program.parse(process.argv);
