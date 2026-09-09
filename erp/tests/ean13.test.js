/**
 * barcode/ean13.js 测试：自研 EAN-13 解码器
 * 用标准码表合成条码灰度图（真实位串）验证解码正确性、校验位过滤、噪声容错、多行投票。
 */
const test = require('node:test');
const assert = require('node:assert');
const ean13 = require('../js/barcode/ean13.js');

/** 合成 EAN-13 条码灰度图：13 位数字 → 标准位串 → 灰度（黑=0 白=255） */
function synthGray(digits13, opts) {
  opts = opts || {};
  const bits = [];
  const parity = ean13.PARITY[+digits13[0]];
  bits.push('101'); // 起始符
  for (let i = 0; i < 6; i++) {
    const d = +digits13[1 + i];
    bits.push(parity[i] === 'O' ? ean13.L_PATS_RAW[d] : ean13.G_PATS_RAW[d]);
  }
  bits.push('01010'); // 分隔符
  for (let i = 0; i < 6; i++) {
    bits.push(ean13.R_PATS_RAW[+digits13[7 + i]]);
  }
  bits.push('101'); // 结束符
  let modules = bits.join('');
  const modulePx = opts.modulePx || 4;
  const quiet = opts.quiet || 20;
  const w = modules.length * modulePx + quiet * 2;
  const h = opts.height || 48;
  const gray = new Uint8Array(w * h).fill(255);
  const drawX0 = quiet;
  for (let m = 0; m < modules.length; m++) {
    const black = modules[m] === '1';
    for (let px = 0; px < modulePx; px++) {
      const x = drawX0 + m * modulePx + px;
      if (black) {
        for (let y = 0; y < h; y++) gray[y * w + x] = 0;
      }
    }
  }
  // 可注入噪声（比例 rows，每行若干随机像素翻转）
  if (opts.noiseRows) {
    for (let y = 0; y < h; y += Math.floor(h / opts.noiseRows)) {
      for (let n = 0; n < (opts.noisePx || 4); n++) {
        const x = quiet + Math.floor(Math.random() * (modules.length * modulePx));
        gray[y * w + x] = Math.random() < 0.5 ? 255 : 0;
      }
    }
  }
  return { gray, width: w, height: h };
}

// 码表原串（解码器内部同源标准表，测试据此合成；与 L_PATS 等价但用位串直读）
ean13.L_PATS_RAW = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
ean13.G_PATS_RAW = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
ean13.R_PATS_RAW = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];

test('decode：合成有效 EAN-13（6901234567892）可解码', () => {
  const { gray, width, height } = synthGray('6901234567892');
  const r = ean13.decode(gray, width, height);
  assert.ok(r, '应解出结果');
  assert.strictEqual(r.text, '6901234567892');
  assert.ok(r.votes >= 3, '多行投票 votes=' + r.votes);
  assert.ok(r.lines > 0);
});

test('decode：另一位有效 EAN-13（4006381333931 常见测试码）可解码', () => {
  // 4006381333931：校验位校验通过
  const { gray, width, height } = synthGray('4006381333931');
  const r = ean13.decode(gray, width, height);
  assert.ok(r && r.text === '4006381333931', '应解出 ' + (r && r.text));
});

test('checksum：校验位计算正确', () => {
  assert.strictEqual(ean13.checksum('690123456789'), 2);
  assert.strictEqual(ean13.checksum('400638133393'), 1);
});

test('decode：校验位错误的条码不会被静默读成原码（校验位过滤生效）', () => {
  // 6901234567890：末位应为 2（校验=2），这里写 0 —— 若解码器返回原码即校验位过滤失效
  const { gray, width, height } = synthGray('6901234567890');
  const r = ean13.decode(gray, width, height);
  assert.notStrictEqual(r && r.text, '6901234567890', '校验位错误不应被读成原码');
});

test('decode：篡改有效条码中间一位后不会被静默读成原码', () => {
  // 把 6901234567892 的第 4 位 1 改为 8（校验位不变 2）→ 解码结果不得等于原码
  const bad = '6908234567892';
  const { gray, width, height } = synthGray(bad);
  const r = ean13.decode(gray, width, height);
  assert.notStrictEqual(r && r.text, bad, '篡改位后不得静默读成篡改码');
});

test('decode：噪声容错——少量随机像素翻转仍可解', () => {
  const { gray, width, height } = synthGray('6901234567892', { noiseRows: 6, noisePx: 3 });
  const r = ean13.decode(gray, width, height);
  assert.ok(r && r.text === '6901234567892', '含噪声应仍可解，got ' + (r && r.text));
});

test('decode：图像过小 / 非法参数返回 null', () => {
  assert.strictEqual(ean13.decode(null, 100, 100), null);
  assert.strictEqual(ean13.decode(new Uint8Array(50 * 30), 50, 30), null, 'width<60');
  assert.strictEqual(ean13.decode(new Uint8Array(200 * 10), 200, 10), null, 'height<20');
});

test('decodeRow：单行解码正确', () => {
  const { gray, width, height } = synthGray('6901234567892', { height: 30 });
  const mid = Math.floor(height / 2);
  const r = ean13.decodeRow(gray, width, height, mid);
  assert.strictEqual(r, '6901234567892');
});
