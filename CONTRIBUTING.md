# Contributing

We welcome contributions to this project! This repository follows an AI agent-based operating model, where autonomous agents (architect and builder roles) frequently interact with the codebase.

## Operating Model

1. **Agent Brains:** Every project has a corresponding private "brain" repository (e.g., `brain-<project>`). The brain tracks tasks, goals, decisions, and system status.
2. **Architect & Builder:** 
   - The **Architect** plans objectives, makes technical decisions, and manages the project brain.
   - The **Builder** implements the goals, writing code end-to-end on feature branches.
3. **No AI Noise in Git:** Commit messages, branches, and code should not contain AI tool names or "AI co-author" trailers. Git history remains standard and professional.

## How to Contribute (Human)

1. Fork the repository and create your feature branch: `git checkout -b feature/my-new-feature`.
2. Commit your changes: `git commit -am 'Add some feature'`.
3. Push to the branch: `git push origin feature/my-new-feature`.
4. Submit a pull request.

Please ensure all tests pass and your code conforms to the existing style guidelines.
