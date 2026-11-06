import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Requer ffmpeg/ffprobe no PATH. DEMO_FONT pode indicar outra fonte TrueType instalada.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'docs/demo')
const base = 'https://raw.githubusercontent.com/eduardoVL123/reprodutor_de_video-/main/docs/demo'
const own = [
  ['hotel-boas-vindas', 'Hotel — Canais internos', 'Boas-vindas ao hóspede', 'Welcome to your stay'],
  ['hotel-servicos', 'Hotel — Canais internos', 'Serviços do hotel', 'Hotel services'],
  ['hotel-restaurante', 'Hotel — Canais internos', 'Cardápio do restaurante', 'Restaurant menu'],
  ['recepcao', 'Recepção e espera', 'Bem-vindo à recepção', 'Welcome to reception'],
  ['avisos', 'Recepção e espera', 'Avisos e horários', 'Notices and opening hours'],
  ['integracao', 'Empresa — Treinamentos', 'Integração de novos colaboradores', 'New employee onboarding'],
  ['seguranca', 'Empresa — Treinamentos', 'Treinamento de segurança', 'Safety training'],
  ['aula-introducao', 'Escola e cursos', 'Aula 1 — Introdução', 'Lesson 1 — Introduction'],
  ['aula-pratica', 'Escola e cursos', 'Aula 2 — Prática', 'Lesson 2 — Practice'],
  ['alongamento', 'Academia', 'Treino em laço — Alongamento', 'Loop workout — Stretching'],
].map(([slug, group, title, english]) => ({ slug, group, title, english, url: `${base}/media/${slug}.mp4` }))
const films = [
  { slug: 'big-buck-bunny', title: 'Big Buck Bunny', english: 'Blender Foundation · CC BY 3.0', url: 'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4' },
  { slug: 'elephants-dream', title: 'Elephants Dream', english: 'Blender Foundation · CC BY 2.5', url: 'https://archive.org/download/ElephantsDream/ed_1024_512kb.mp4' },
  { slug: 'tears-of-steel', title: 'Tears of Steel', english: 'Blender Foundation · CC BY 3.0', url: 'https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov' },
  { slug: 'sintel', title: 'Sintel — Trailer', english: 'Blender Foundation · CC BY 3.0', url: 'https://download.blender.org/durian/trailer/sintel_trailer-720p.mp4' },
].map((item) => ({ ...item, group: 'Filmes de demonstração' }))
const live = [
  { slug: 'canal-bunny', title: 'Big Buck Bunny — teste HLS', english: 'Blender Foundation · CC BY 3.0', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' },
  { slug: 'canal-steel', title: 'Tears of Steel — teste HLS', english: 'Blender Foundation · CC BY 3.0', url: 'https://test-streams.mux.dev/tos_ismc/main.m3u8' },
].map((item) => ({ ...item, credit: item.english, english: 'Live test stream · CC BY 3.0', group: 'Eventos e transmissões de demonstração' }))
const work = mkdtempSync(join(tmpdir(), 'pulse-demo-'))
const sample = process.argv.includes('--sample')

function run(binary, args) {
  const result = spawnSync(binary, args, { cwd: work, encoding: 'utf8', timeout: 120000, windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(`${binary}: ${result.error?.message || result.stderr}`)
  return result.stdout
}

function textFile(name, text) {
  writeFileSync(join(work, name), text)
  return name
}

function wrap(text, limit) {
  const lines = ['']
  for (const word of text.split(' ')) {
    if (lines.at(-1).length + word.length + 1 > limit) lines.push(word)
    else lines[lines.length - 1] += `${lines.at(-1) ? ' ' : ''}${word}`
  }
  return lines.join('\n')
}

function label(file, size, x, y, color = '0xF4F7EE') {
  return `drawtext=fontfile=font.ttf:textfile=${file}:fontsize=${size}:fontcolor=${color}:x=${x}:y=${y}:line_spacing=14`
}

function video(item) {
  textFile('title.txt', wrap(item.title, 32))
  textFile('english.txt', item.english)
  textFile('group.txt', item.group)
  textFile('demo.txt', 'DEMONSTRAÇÃO / DEMO')
  const filters = [
    'drawbox=x=80:y=70:w=72:h=8:color=0xB8F000:t=fill',
    label('demo.txt', 22, 178, 64, '0xB8F000'),
    label('group.txt', 26, 80, 170, '0xA2B19F'),
    label('title.txt', 52, 80, 245),
    label('english.txt', 30, 80, 420, '0xB8F000'),
    "drawtext=fontfile=font.ttf:text='%{pts\\:hms}':fontsize=26:fontcolor=0xA2B19F:x=80:y=580",
    'drawbox=x=80:y=640:w=1120:h=4:color=0x30402F:t=fill',
    ...Array.from({ length: 30 }, (_, i) => `drawbox=x=${80 + Math.floor(i * 1120 / 30)}:y=638:w=38:h=8:color=0xB8F000:t=fill:enable='gte(t,${i / 2})'`),
  ].join(',')
  const target = join(out, 'media', `${item.slug}.mp4`)
  run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x0B0F0C:s=1280x720:r=25:d=15',
    '-f', 'lavfi', '-i', 'aevalsrc=0.1*(sin(2*PI*220*t)+sin(2*PI*277.18*t)+sin(2*PI*329.63*t)):s=44100:d=15',
    '-vf', filters, '-af', 'afade=t=in:d=0.5,afade=t=out:st=14:d=1', '-ac', '2', '-c:v', 'libx264', '-profile:v', 'main',
    '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '28', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-t', '15', target])
  const info = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', target]))
  const v = info.streams.filter((stream) => stream.codec_type === 'video')
  const a = info.streams.filter((stream) => stream.codec_type === 'audio')
  if (v.length !== 1 || v[0].height !== 720 || a.length !== 1 || a[0].channels !== 2 || Math.abs(Number(info.format.duration) - 15) > 0.2 || statSync(target).size > 1_000_000) {
    throw new Error(`Formato, duração ou peso fora do previsto: ${target}`)
  }
  console.log(`Vídeo validado: ${item.slug} (${statSync(target).size} bytes)`)
}

function cover(item, film = false) {
  const input = film ? ['-ss', '30', '-rw_timeout', '15000000', '-i', item.url] : ['-f', 'lavfi', '-i', 'color=c=0x0B0F0C:s=600x900']
  textFile('title.txt', wrap(item.title, 19))
  textFile('english.txt', wrap(item.english, 33))
  textFile('group.txt', wrap(item.group, 31))
  textFile('demo.txt', 'DEMONSTRAÇÃO / DEMO')
  textFile('brand.txt', 'PULSE PLAYER')
  const filters = [
    'scale=600:900:force_original_aspect_ratio=increase,crop=600:900',
    'drawbox=x=0:y=0:w=600:h=900:color=0x0B0F0C@0.65:t=fill',
    'drawbox=x=42:y=60:w=64:h=7:color=0xB8F000:t=fill',
    label('demo.txt', 20, 42, 95, '0xB8F000'), label('group.txt', 23, 42, 175, '0xA2B19F'),
    label('title.txt', 44, 42, 330), label('english.txt', 23, 42, 580, '0xB8F000'),
    'drawbox=x=42:y=768:w=516:h=1:color=0x53634D:t=fill', label('brand.txt', 23, 42, 800),
    'format=yuvj420p',
  ].join(',')
  const temporary = join(work, 'cover.jpg')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...input, '-vf', filters, '-frames:v', '1', '-q:v', '3', '-update', '1', temporary])
      break
    } catch (err) {
      if (!film || attempt === 2) throw err
      console.warn(`Repetindo a extração de ${item.slug}: tentativa ${attempt + 2}`)
    }
  }
  copyFileSync(temporary, join(out, 'capas', `${item.slug}.jpg`))
  console.log(`Capa: ${item.slug}`)
}

try {
  mkdirSync(join(out, 'media'), { recursive: true })
  mkdirSync(join(out, 'capas'), { recursive: true })
  copyFileSync(process.env.DEMO_FONT || 'C:/Windows/Fonts/arial.ttf', join(work, 'font.ttf'))
  for (const item of sample ? own.slice(0, 1) : own) {
    video(item)
    cover(item)
  }
  if (!sample) {
    for (const item of films) cover(item, true)
    for (const item of live) cover(item)
    const entries = [...own, ...live, ...films].map((item) => {
      const title = own.includes(item) ? item.title : `${item.title} (${item.credit || item.english})`
      return `#EXTINF:-1 tvg-logo="${base}/capas/${item.slug}.jpg" group-title="${item.group}",${title}\n${item.url}`
    })
    writeFileSync(join(out, 'pulse-demo.m3u'), `#EXTM3U\n${entries.join('\n')}\n`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
