# llm-debugger

A debugging tool that integrates LLMs with a debugging server. Currently only supports Node.js, with plans to expand to other programming languages in the future.

## Prerequisites
- Node.js 20 or higher
- pnpm package manager
- OpenAI API key or any compatible OpenAI API key (e.g. OpenRouter)

## Installation

Clone git repository:

```bash
git clone https://github.com/frolleks/llm-debugger && cd llm-debugger
```

Install dependencies:

```bash
pnpm install
```

Create a `.env` file and add your OpenAI API key:

```
OPENAI_API_KEY=your_api_key_here
```

Build the application:

```bash
pnpm build
```

## Usage

1. Start a Node.js debugging session:

```bash
node --inspect-brk <file.js>
```

2. Launch the debugger:

```bash
node dist/index.js
```