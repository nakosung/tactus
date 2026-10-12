# Contributing to Tactus

Thank you for helping. Bug reports, new sounds, new example songs, language features, docs and translations are all welcome.

## Before you start

- For a bug, open an issue with the code that shows it and the browser you used. A recording helps a lot.
- For a larger change (a new language feature, a new engine part, a change to the file layout), open an issue first so the design can be agreed before you write it.
- Small fixes can go straight to a pull request.

## Working on it

```sh
python3 build.py && python3 -m http.server -d dist 8000   # open http://localhost:8000/play/
node tests/compile.test.js
```

The source is plain JavaScript in `src/js/`, with no bundler and no dependencies. `build.py` inlines everything into one HTML file per page, so check your change in the built page.

## What a good pull request looks like

- **One change per pull request.** Keep the description short: what changes, and how to hear or see it.
- **Sound changes come with ears.** Say which preset, scene or bars to listen to, and attach a short before/after recording if you can. Every sound in Tactus was tuned by listening, so that is how it gets reviewed.
- **Both languages.** User-facing text lives in `src/js/i18n.js`, in Korean and English. Add both. If you only write one, say so and a reviewer will help.
- **Example songs keep compiling.** `node tests/compile.test.js` must pass. If you change the language, add a broken line to the test that your change should reject.
- **No new runtime dependencies** without discussion. The app is meant to work from a single file.
- **Data needs a license.** New samples or weights must allow redistribution; add them to `ATTRIBUTION.md`.
- **Comments say why.** Name things for what they do, and explain the reason behind a non-obvious choice in a comment.

## AI-assisted contributions

Tactus itself was written with an AI agent, so agent-written pull requests are welcome too. The same rules apply: you are responsible for what you submit, the change must be tested, and sound changes must have been listened to. Agents should read [AGENTS.md](AGENTS.md).

## License of contributions

By submitting a contribution you agree that it is licensed under MIT or Apache-2.0, at the user's option, like the rest of the code.

---

**한국어 요약:** 이슈와 PR 모두 환영합니다.

- 큰 변경은 이슈로 먼저 의논해 주세요.
- 소리를 바꿨다면 어떤 곡의 어디를 들으면 되는지 적고, 가능하면 전후 녹음을 붙여 주세요.
- 화면에 보이는 글은 `src/js/i18n.js`에 한국어와 영어를 함께 넣어 주세요.
- `node tests/compile.test.js`가 통과해야 합니다.
- 새 샘플이나 데이터는 재배포가 가능한 라이선스여야 합니다.
