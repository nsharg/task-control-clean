# Contributing to Task Control

Contributions are welcome: bug fixes, documentation, tests, accessibility
improvements, and new features. For substantial changes, open an issue to
discuss the proposal before implementing it.

## Getting started

1. Fork this repository and clone your fork.
2. Create a branch for your change.
3. Run `npm ci` to install the locked dependencies.
4. Follow the [local setup instructions](README.md#run-it-locally), using
   your own development deployment and synthetic data.
5. Make your change and run the checks:

   ```sh
   npm run typecheck
   npm run lint
   npm test
   ```

6. Open a pull request describing the problem, the change, and how you
   verified it. Include screenshots for visible UI changes when useful.

Keep changes focused. Tests should cover behavior that could regress.
Describe any checks you could not run.

## Privacy and security

Use fictional names, example domains, and synthetic fixtures. Do not commit
credentials, environment files, personal information, private deployment
addresses, or real customer data. Review screenshots and logs before posting
them. Use a privacy-preserving Git author email if you do not want your
personal email to become part of the public commit history.

Do not post credentials or exploitable security details in public issues.

## License

By submitting a contribution, you agree that it may be distributed under this
project's [MIT License](LICENSE). Only submit material you have the right to
contribute. Third-party dependencies retain their respective licenses.
