const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cleanDirectiveText,
  consumeDirectiveChunk
} = require("../src/main/directive-stream");

test("directives split across chunks never leak into visible text", () => {
  const state = { tail: "" };
  const directives = [];
  const first = consumeDirectiveChunk(state, "你好 [[mood:", (item) => directives.push(item));
  const second = consumeDirectiveChunk(state, "sad]] 博士", (item) => directives.push(item));

  assert.equal(first, "你好 ");
  assert.equal(second, " 博士");
  assert.deepEqual(directives.map((item) => [item.type, item.value]), [["mood", "sad"]]);
  assert.equal(state.tail, "");
});

test("a directive split between its opening brackets is retained", () => {
  const state = { tail: "" };
  const directives = [];
  const first = consumeDirectiveChunk(state, "记住这件事 [", (item) => directives.push(item));
  const second = consumeDirectiveChunk(
    state,
    "[remember:博士喜欢安静]] 好了",
    (item) => directives.push(item)
  );

  assert.equal(first, "记住这件事 ");
  assert.equal(second, " 好了");
  assert.equal(directives.length, 1);
  assert.equal(directives[0].type, "remember");
  assert.equal(directives[0].value, "博士喜欢安静");
});

test("full-width directive colons remain hidden across chunks", () => {
  const state = { tail: "" };
  const directives = [];

  assert.equal(
    consumeDirectiveChunk(state, "等等 [[mood：", (item) => directives.push(item)),
    "等等 "
  );
  assert.equal(
    consumeDirectiveChunk(state, "sad]] 博士", (item) => directives.push(item)),
    " 博士"
  );
  assert.deepEqual(directives.map((item) => item.value), ["sad"]);
});

test("completed directives are processed once as later chunks arrive", () => {
  const state = { tail: "" };
  const moods = [];
  const onDirective = (item) => {
    if (item.type === "mood") moods.push(item.value);
  };

  assert.equal(
    consumeDirectiveChunk(state, "[[mood:sad]]A[[mood:smile]]B", onDirective),
    "AB"
  );
  assert.equal(consumeDirectiveChunk(state, "C", onDirective), "C");
  assert.deepEqual(moods, ["sad", "smile"]);
});

test("final cleanup is side-effect free and removes dangling tags", () => {
  assert.equal(
    cleanDirectiveText("[[mood:smile]]你好[[remember:一件事]]"),
    "你好"
  );
  assert.equal(cleanDirectiveText("回答完成 [[skill:open_url"), "回答完成");
});
