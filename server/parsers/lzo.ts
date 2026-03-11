/**
 * LZO1X decompression for Arma 3 / BIS compressed data.
 * Based on the miniLZO algorithm and grad_aff C++ implementation.
 * Reference: https://community.bistudio.com/wiki/Compressed_LZO_File_Format
 */

const M2_MAX_OFFSET = 0x0800;

export function decompressLzo(
  input: Buffer,
  inputOffset: number,
  expectedSize: number
): { data: Buffer; bytesRead: number } {
  const output = Buffer.alloc(expectedSize);
  let ip = inputOffset; // input pointer
  let op = 0; // output pointer
  let t: number;
  let mPos: number; // match position in output

  if (input[ip] > 17) {
    t = input[ip++] - 17;
    if (t < 4) {
      // match_next
      if (t > 0) {
        for (let i = 0; i < t; i++) output[op++] = input[ip++];
      }
      t = input[ip++];
      // goto match
      return doMatch();
    }
    // copy t literal bytes
    for (let i = 0; i < t; i++) output[op++] = input[ip++];
    // first_literal_run
    t = input[ip++];
    if (t >= 16) return doMatch();

    mPos = op - (1 + M2_MAX_OFFSET);
    mPos -= t >> 2;
    mPos -= input[ip++] << 2;
    output[op++] = output[mPos++];
    output[op++] = output[mPos++];
    output[op++] = output[mPos];
    // match_done
    return matchDone();
  }

  // B_3
  function b3(): { data: Buffer; bytesRead: number } {
    t = input[ip++];
    if (t >= 16) return doMatch();

    if (t === 0) {
      while (input[ip] === 0) {
        t += 255;
        ip++;
      }
      t += 15 + input[ip++];
    }
    // copy t + 3 literal bytes
    for (let i = 0; i < t + 3; i++) {
      output[op++] = input[ip++];
    }
    // Remove extra increment - the loop handles exact count

    // first_literal_run
    t = input[ip++];
    if (t >= 16) return doMatch();

    mPos = op - (1 + M2_MAX_OFFSET);
    mPos -= t >> 2;
    mPos -= input[ip++] << 2;
    output[op++] = output[mPos++];
    output[op++] = output[mPos++];
    output[op++] = output[mPos];
    return matchDone();
  }

  function doMatch(): { data: Buffer; bytesRead: number } {
    while (true) {
      if (t >= 64) {
        mPos = op - 1;
        mPos -= (t >> 2) & 7;
        mPos -= input[ip++] << 3;
        t = (t >> 5) - 1;
        // copy_match
        output[op++] = output[mPos++];
        output[op++] = output[mPos++];
        while (t > 0) {
          output[op++] = output[mPos++];
          t--;
        }
      } else if (t >= 32) {
        t &= 31;
        if (t === 0) {
          while (input[ip] === 0) {
            t += 255;
            ip++;
          }
          t += 31 + input[ip++];
        }
        mPos = op - 1;
        mPos -= (input[ip] >> 2) + (input[ip + 1] << 6);
        ip += 2;

        if (t >= 6 && (op - mPos) >= 4) {
          // fast copy
          output[op++] = output[mPos++];
          output[op++] = output[mPos++];
          output[op++] = output[mPos++];
          output[op++] = output[mPos++];
          let rem = t - (4 - 2);
          while (rem >= 4) {
            output[op++] = output[mPos++];
            output[op++] = output[mPos++];
            output[op++] = output[mPos++];
            output[op++] = output[mPos++];
            rem -= 4;
          }
          while (rem > 0) {
            output[op++] = output[mPos++];
            rem--;
          }
        } else {
          // copy_match
          output[op++] = output[mPos++];
          output[op++] = output[mPos++];
          while (t > 0) {
            output[op++] = output[mPos++];
            t--;
          }
        }
      } else if (t >= 16) {
        mPos = op;
        mPos -= (t & 8) << 11;

        t &= 7;
        if (t === 0) {
          while (input[ip] === 0) {
            t += 255;
            ip++;
          }
          t += 7 + input[ip++];
        }

        mPos -= (input[ip] >> 2) + (input[ip + 1] << 6);
        ip += 2;

        if (mPos === op) {
          // End of compressed data
          return { data: output, bytesRead: ip - inputOffset };
        }
        mPos -= 0x4000;

        if (t >= 6 && (op - mPos) >= 4) {
          output[op++] = output[mPos++];
          output[op++] = output[mPos++];
          output[op++] = output[mPos++];
          output[op++] = output[mPos++];
          let rem = t - (4 - 2);
          while (rem >= 4) {
            output[op++] = output[mPos++];
            output[op++] = output[mPos++];
            output[op++] = output[mPos++];
            output[op++] = output[mPos++];
            rem -= 4;
          }
          while (rem > 0) {
            output[op++] = output[mPos++];
            rem--;
          }
        } else {
          output[op++] = output[mPos++];
          output[op++] = output[mPos++];
          while (t > 0) {
            output[op++] = output[mPos++];
            t--;
          }
        }
      } else {
        // t < 16
        mPos = op - 1;
        mPos -= t >> 2;
        mPos -= input[ip++] << 2;
        output[op++] = output[mPos++];
        output[op++] = output[mPos];
        // match_done below
      }

      // match_done
      t = input[ip - 2] & 3;
      if (t === 0) {
        // goto B_3
        t = input[ip++];
        if (t >= 16) continue; // goto match (loop again)

        if (t === 0) {
          while (input[ip] === 0) {
            t += 255;
            ip++;
          }
          t += 15 + input[ip++];
        }
        for (let i = 0; i < t + 3; i++) {
          output[op++] = input[ip++];
        }

        t = input[ip++];
        if (t >= 16) continue; // goto match

        mPos = op - (1 + M2_MAX_OFFSET);
        mPos -= t >> 2;
        mPos -= input[ip++] << 2;
        output[op++] = output[mPos++];
        output[op++] = output[mPos++];
        output[op++] = output[mPos];

        t = input[ip - 2] & 3;
        if (t === 0) continue;
      }

      // match_next: copy t literal bytes
      for (let i = 0; i < t; i++) {
        output[op++] = input[ip++];
      }

      t = input[ip++];
      // loop back to match
    }
  }

  function matchDone(): { data: Buffer; bytesRead: number } {
    t = input[ip - 2] & 3;
    if (t === 0) return b3();

    // match_next
    for (let i = 0; i < t; i++) {
      output[op++] = input[ip++];
    }
    t = input[ip++];
    return doMatch();
  }

  return b3();
}
