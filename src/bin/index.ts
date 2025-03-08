#!/usr/bin/env node

import { Command } from 'commander';

const program = new Command();

program
  .version('0.0.0')
  .description('A client for connecting an LLM with the Node.js debugger');

program
  .command('start')
  .description('Start the LLM to debug')
  .action(() => {
    console.log('hello world');
  });

program.parse(process.argv);
