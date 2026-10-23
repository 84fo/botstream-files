import { createReadStream } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Demuxer } from 'node-av';

const filePath = join(tmpdir(), 'transcode_annexb_test.mkv');
console.log('Testing:', filePath);

const demuxer = await Demuxer.open(createReadStream(filePath), { format: 'matroska', bufferSize: 65536 });
const vStream = demuxer.video();
const aStream = demuxer.audio();
console.log('video index:', vStream?.index, 'codec:', vStream?.codecpar.codecId);
console.log('audio index:', aStream?.index);

const iter = demuxer.packets();
let vCount = 0, aCount = 0, errCount = 0;
for (let i = 0; i < 50; i++) {
  const { value: pkt, done } = await iter.next();
  if (done) { console.log('done at:', i); break; }
  if (!pkt) { errCount++; console.log('null at:', i); continue; }
  if (pkt.streamIndex === vStream?.index) vCount++;
  else aCount++;
  pkt.free();
}
console.log(`video=${vCount} audio=${aCount} nulls=${errCount}`);
console.log(vCount > 0 ? '✅ SUCCESS!' : '❌ FAIL');
demuxer.close();
process.exit(0);
