import { readdirSync, statSync, createReadStream } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const files = readdirSync(tmpdir())
  .filter(f => f.endsWith('.mkv') && (f.startsWith('transcode_') || f === 'transcode_test_final.mkv'))
  .map(f => ({ f, t: statSync(join(tmpdir(), f)).mtimeMs }))
  .sort((a,b) => b.t - a.t);

if (!files.length) { console.log('No mkv files'); process.exit(1); }
const filePath = join(tmpdir(), files[0].f);
console.log('Testing:', filePath);

const { demux } = await import('@dank074/discord-video-stream');
const stream = createReadStream(filePath);
try {
  const result = await demux(stream, { format: 'matroska' });
  console.log('video:', result.video ? `${result.video.width}x${result.video.height}` : 'NONE');
  console.log('audio:', result.audio ? 'YES' : 'NONE');

  let vCount = 0, aCount = 0;
  result.video?.stream.on('data', (d) => {
    vCount++;
    if (vCount <= 2) console.log(`video pkt ${vCount}: pts=${d.pts} dur=${d.duration} timeBase=${JSON.stringify(d.timeBase)}`);
  });
  result.audio?.stream.on('data', () => aCount++);
  result.video?.stream.on('end', () => console.log('video ended, packets:', vCount));

  setTimeout(() => {
    console.log('After 5s: video=', vCount, 'audio=', aCount);
    console.log(vCount > 0 ? '✅ SUCCESS!' : '❌ FAIL');
    process.exit(0);
  }, 5000);
} catch(e) {
  console.log('Error:', e.message);
  process.exit(1);
}
