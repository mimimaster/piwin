/**
 * Source of `symbolizeHangSample`, spliced into the hang watchdog worker (an
 * `eval` worker, so it cannot import modules). Kept as its own string so tests
 * can load and exercise it without a real hang.
 *
 * macOS `sample` prints JIT-compiled JavaScript as
 * `???  (in <unknown binary>)  [0x111090064]`. V8's `perf-<pid>.map` lists
 * `<start hex> <size hex> <name>` for every function it compiled, so each
 * address is renamed to the function whose range contains it. When V8
 * recompiles a function the newer line wins.
 *
 * Returns `{ text, resolved, culprit }`: the rewritten sample, how many
 * distinct addresses got a name, and the main thread's hottest named frame
 * (most samples, then deepest), which is the function the thread is stuck in.
 */
export const HOST_JIT_SYMBOLIZER_SOURCE = String.raw`
function symbolizeHangSample(sampleText, mapText) {
  var unknownFrame = /\?\?\?\s+\(in <unknown binary>\)\s+\[0x([0-9a-f]+)\]/g;
  var wanted = new Map();
  var found;
  while ((found = unknownFrame.exec(sampleText)) !== null) {
    wanted.set(found[1], parseInt(found[1], 16));
  }
  var names = new Map();
  if (wanted.size > 0) {
    var lines = mapText.split('\n');
    for (var index = 0; index < lines.length; index += 1) {
      var line = lines[index];
      var firstSpace = line.indexOf(' ');
      var secondSpace = firstSpace > 0 ? line.indexOf(' ', firstSpace + 1) : -1;
      if (secondSpace <= firstSpace) continue;
      var start = parseInt(line.slice(0, firstSpace), 16);
      var end = start + parseInt(line.slice(firstSpace + 1, secondSpace), 16);
      if (!(end > start)) continue;
      for (var entry of wanted) {
        if (entry[1] >= start && entry[1] < end) names.set(entry[0], line.slice(secondSpace + 1));
      }
    }
  }
  if (names.size === 0) return { text: sampleText, resolved: 0, culprit: undefined };

  var text = sampleText.replace(unknownFrame, function (frame, hex) {
    var name = names.get(hex);
    return name === undefined ? frame : name + '  (in <jit>)  [0x' + hex + ']';
  });

  // The main thread block runs from its header to the next top-level thread.
  var outputLines = text.split('\n');
  var first = outputLines.findIndex(function (line) { return line.indexOf('com.apple.main-thread') !== -1; });
  var culprit;
  var best = { count: -1, depth: -1 };
  for (var at = first === -1 ? 0 : first + 1; at < outputLines.length; at += 1) {
    var row = outputLines[at];
    if (first !== -1 && /^\s{4}\d+ Thread_/.test(row)) break;
    if (row.indexOf('(in <jit>)') === -1) continue;
    var counted = /^([\s+!:|]*)(\d+) (.*?)  \(in <jit>\)/.exec(row);
    if (counted === null) continue;
    var count = Number(counted[2]);
    var depth = counted[1].length;
    if (count > best.count || (count === best.count && depth > best.depth)) {
      best = { count: count, depth: depth };
      culprit = counted[3];
    }
  }
  return { text: text, resolved: names.size, culprit: culprit };
}
`;
