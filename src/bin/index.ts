#!/usr/bin/env node

import { Command } from 'commander';

const program = new Command();

program
  .version('0.0.0')
  .description('A client for connecting an LLM with the Node.js debugger');

program.parse(process.argv);
