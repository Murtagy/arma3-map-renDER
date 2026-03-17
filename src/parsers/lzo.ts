const M2_MAX_OFFSET = 0x0800;

function ensureInput(input: Uint8Array, ip: number, need: number) {
  if (ip + need > input.length) {
    throw new Error(`LZO input overrun at ${ip}, need ${need}, len ${input.length}`);
  }
}

function ensureOutput(op: number, need: number, outLen: number) {
  if (op + need > outLen) {
    throw new Error(`LZO output overrun at ${op}, need ${need}, len ${outLen}`);
  }
}

function ensureLookbehind(mPos: number) {
  if (mPos < 0) {
    throw new Error(`LZO lookbehind overrun at ${mPos}`);
  }
}

function copyLiteral(input: Uint8Array, output: Uint8Array, ip: number, op: number, count: number) {
  ensureInput(input, ip, count);
  ensureOutput(op, count, output.length);
  for (let i = 0; i < count; i++) {
    output[op++] = input[ip++];
  }
  return { ip, op };
}

function copyMatch(output: Uint8Array, mPos: number, op: number, count: number) {
  ensureLookbehind(mPos);
  ensureOutput(op, count, output.length);
  for (let i = 0; i < count; i++) {
    output[op++] = output[mPos++];
  }
  return { mPos, op };
}

function readExtendedLength(
  input: Uint8Array,
  ip: number,
  t: number,
  base: number
): { ip: number; t: number } {
  while (true) {
    ensureInput(input, ip, 1);
    const v = input[ip++];
    if (v === 0) {
      t += 255;
      continue;
    }
    t += base + v;
    return { ip, t };
  }
}

export function decompressLzo(
  input: Uint8Array,
  inputOffset: number,
  expectedSize: number
): { data: Uint8Array; bytesRead: number } {
  const output = new Uint8Array(expectedSize);

  let ip = inputOffset;
  let op = 0;
  let t = 0;

  ensureInput(input, ip, 1);

  if (input[ip] > 17) {
    t = input[ip++] - 17;
    if (t < 4) {
      // match_next
      if (t > 0) {
        const copied = copyLiteral(input, output, ip, op, t);
        ip = copied.ip;
        op = copied.op;
      }
      ensureInput(input, ip, 1);
      t = input[ip++];
    } else {
      const copied = copyLiteral(input, output, ip, op, t);
      ip = copied.ip;
      op = copied.op;

      // first_literal_run
      ensureInput(input, ip, 1);
      t = input[ip++];
      if (t < 16) {
        ensureInput(input, ip, 1);
        let mPos = op - (1 + M2_MAX_OFFSET);
        mPos -= t >> 2;
        mPos -= input[ip++] << 2;
        const matched = copyMatch(output, mPos, op, 3);
        op = matched.op;

        // match_done
        ensureInput(input, ip - 2, 1);
        t = input[ip - 2] & 3;
        if (t === 0) {
          // continue to outer literal loop
        } else {
          const tail = copyLiteral(input, output, ip, op, t);
          ip = tail.ip;
          op = tail.op;
          ensureInput(input, ip, 1);
          t = input[ip++];
        }
      }
    }
  }

  outer: for (;;) {
    if (t === 0) {
      ensureInput(input, ip, 1);
      t = input[ip++];

      if (t < 16) {
        if (t === 0) {
          const ext = readExtendedLength(input, ip, t, 15);
          ip = ext.ip;
          t = ext.t;
        }

        // t + 3 literals
        const copied = copyLiteral(input, output, ip, op, t + 3);
        ip = copied.ip;
        op = copied.op;

        // first_literal_run
        ensureInput(input, ip, 1);
        t = input[ip++];
        if (t < 16) {
          ensureInput(input, ip, 1);
          let mPos = op - (1 + M2_MAX_OFFSET);
          mPos -= t >> 2;
          mPos -= input[ip++] << 2;
          const matched = copyMatch(output, mPos, op, 3);
          op = matched.op;

          // match_done
          ensureInput(input, ip - 2, 1);
          t = input[ip - 2] & 3;
          if (t === 0) {
            continue outer;
          }

          // match_next
          const tail = copyLiteral(input, output, ip, op, t);
          ip = tail.ip;
          op = tail.op;
          ensureInput(input, ip, 1);
          t = input[ip++];
        }
      }
    }

    for (;;) {
      let mPos: number;
      let matchLen: number;

      if (t >= 64) {
        ensureInput(input, ip, 1);
        mPos = op - 1;
        mPos -= (t >> 2) & 7;
        mPos -= input[ip++] << 3;
        matchLen = ((t >> 5) - 1) + 2;
      } else if (t >= 32) {
        t &= 31;
        if (t === 0) {
          const ext = readExtendedLength(input, ip, t, 31);
          ip = ext.ip;
          t = ext.t;
        }

        ensureInput(input, ip, 2);
        mPos = op - 1;
        mPos -= (input[ip] >> 2) + (input[ip + 1] << 6);
        ip += 2;
        matchLen = t + 2;
      } else if (t >= 16) {
        mPos = op;
        mPos -= (t & 8) << 11;
        t &= 7;

        if (t === 0) {
          const ext = readExtendedLength(input, ip, t, 7);
          ip = ext.ip;
          t = ext.t;
        }

        ensureInput(input, ip, 2);
        mPos -= (input[ip] >> 2) + (input[ip + 1] << 6);
        ip += 2;

        if (mPos === op) {
          // EOF marker in the stream.
          return { data: output.subarray(0, op), bytesRead: ip - inputOffset };
        }

        mPos -= 0x4000;
        matchLen = t + 2;
      } else {
        ensureInput(input, ip, 1);
        mPos = op - 1;
        mPos -= t >> 2;
        mPos -= input[ip++] << 2;

        const matched = copyMatch(output, mPos, op, 2);
        op = matched.op;

        ensureInput(input, ip - 2, 1);
        t = input[ip - 2] & 3;
        if (t === 0) {
          continue outer;
        }

        const tail = copyLiteral(input, output, ip, op, t);
        ip = tail.ip;
        op = tail.op;

        ensureInput(input, ip, 1);
        t = input[ip++];
        continue;
      }

      const matched = copyMatch(output, mPos, op, matchLen);
      op = matched.op;

      ensureInput(input, ip - 2, 1);
      t = input[ip - 2] & 3;
      if (t === 0) {
        continue outer;
      }

      const tail = copyLiteral(input, output, ip, op, t);
      ip = tail.ip;
      op = tail.op;

      ensureInput(input, ip, 1);
      t = input[ip++];
    }
  }
}
