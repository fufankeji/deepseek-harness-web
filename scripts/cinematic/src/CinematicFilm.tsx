import type {CSSProperties, FC, ReactNode} from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {FlashCut} from './lib/FlashCut';
import {PageCam} from './lib/PageCam';
import {SHOTS} from './film.config';

export type CinematicFilmProps = {
  bgm: boolean;
};

const colors = {
  ink: '#07101f',
  inkSoft: '#101c32',
  blue: '#2f6dff',
  cyan: '#6ae5ff',
  mint: '#62ddb5',
  white: '#f7fbff',
  paper: '#f4f7ff',
  muted: '#91a0b8',
  line: 'rgba(170, 205, 255, 0.22)',
};

const font = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif';
const mono = '"SFMono-Regular", "JetBrains Mono", Menlo, monospace';
const ease = Easing.bezier(0.3, 0, 0.2, 1);
const officialModelName = ['DeepSeek', 'V4 Pro'].join(' ');
const officialProductName = ['FF', 'DeepSeek Harness Web'].join(' - ');

export const CinematicFilm: FC<CinematicFilmProps> = ({bgm}) => {
  return (
    <AbsoluteFill
      data-bgm={bgm ? 'on' : 'off'}
      style={{backgroundColor: colors.ink, color: colors.white, fontFamily: font, overflow: 'hidden'}}
    >
      <AmbientField />
      <Sequence from={SHOTS.gate.from} durationInFrames={SHOTS.gate.duration}>
        <GateShot />
      </Sequence>
      <Sequence from={SHOTS.setup.from} durationInFrames={SHOTS.setup.duration}>
        <SetupShot />
      </Sequence>
      <Sequence from={SHOTS.task.from} durationInFrames={SHOTS.task.duration}>
        <TaskShot />
      </Sequence>
      <Sequence from={SHOTS.execution.from} durationInFrames={SHOTS.execution.duration}>
        <ExecutionShot />
      </Sequence>
      <Sequence from={SHOTS.diff.from} durationInFrames={SHOTS.diff.duration}>
        <DiffShot />
      </Sequence>
      <Sequence from={SHOTS.build.from} durationInFrames={SHOTS.build.duration}>
        <BuildShot />
      </Sequence>
      <Sequence from={SHOTS.product.from} durationInFrames={SHOTS.product.duration}>
        <ProductShot />
      </Sequence>
      <Sequence from={SHOTS.evaluation.from} durationInFrames={SHOTS.evaluation.duration}>
        <EvaluationShot />
      </Sequence>
      <Sequence from={SHOTS.commands.from} durationInFrames={SHOTS.commands.duration}>
        <CommandsShot />
      </Sequence>
      <Sequence from={SHOTS.outro.from} durationInFrames={SHOTS.outro.duration}>
        <OutroShot />
      </Sequence>

      {[790, 2215, 2905].map((from) => (
        <Sequence key={from} from={from} durationInFrames={12}>
          <FlashCut duration={12} />
        </Sequence>
      ))}
      {bgm ? <Audio src={staticFile('audio/original-score.wav')} volume={2.7} /> : null}
      <Audio src={staticFile('audio/original-sfx.wav')} volume={1.05} />
      <FilmFinish />
    </AbsoluteFill>
  );
};

const GateShot: FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const titleIn = spring({frame: frame - 8, fps, config: {damping: 18, stiffness: 84}});
  const screenIn = interpolate(frame, [72, 138], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease,
  });
  const drift = interpolate(frame, [0, 164], [0.96, 1.035], {extrapolateRight: 'clamp'});

  return (
    <ShotFade duration={SHOTS.gate.duration} fadeOut={0}>
      <div style={{position: 'absolute', inset: 0, overflow: 'hidden'}}>
        <BrowserPanel
          style={{
            inset: 44,
            opacity: screenIn * 0.94,
            transform: `translateX(${(1 - screenIn) * 760}px) scale(${0.84 + screenIn * 0.16})`,
          }}
        >
          <Screenshot src="textures/setup/environment.png" />
        </BrowserPanel>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(90deg, ${colors.ink} 0%, rgba(7,16,31,0.96) 43%, rgba(7,16,31,${0.72 - screenIn * 0.45}) 72%, rgba(7,16,31,0.08) 100%)`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 142,
            top: 116,
            width: 940,
            transform: `translateY(${(1 - titleIn) * 52}px) scale(${drift})`,
            transformOrigin: 'left center',
            opacity: titleIn,
          }}
        >
          <BrandLine />
          <h1 style={{fontSize: 112, lineHeight: 1.02, letterSpacing: '-0.065em', margin: '84px 0 0', fontWeight: 760}}>
            让 DeepSeek
            <br />
            真正进入项目
          </h1>
          <p style={{fontSize: 30, color: '#afbdd2', margin: '34px 0 0', letterSpacing: '0.02em'}}>
            浏览器里的真实开发工作台
          </p>
        </div>
        <div
          style={{
            position: 'absolute',
            left: 142,
            bottom: 94,
            color: colors.cyan,
            fontSize: 20,
            letterSpacing: '0.14em',
            opacity: interpolate(frame, [40, 70], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
          }}
        >
          官方 DeepSeek Harness · 真实项目链路
        </div>
      </div>
    </ShotFade>
  );
};

const setupStates = [
  {src: 'textures/setup/environment.png', label: '选择运行环境', detail: '官方 DeepSeek Harness，也保留 Pi Agent 兼容链'},
  {src: 'textures/setup/model-v4-pro.png', label: '连接模型', detail: '本片真实使用 DeepSeek V4 Pro'},
  {src: 'textures/setup/workspace.png', label: '选择工作区', detail: '普通本地代码目录，无需专用工程格式'},
  {src: 'textures/setup/trust.png', label: '确认项目权限', detail: '访问边界在执行前明确确认'},
  {src: 'textures/setup/summary.png', label: '进入工作台', detail: '配置摘要清晰可核对'},
] as const;

const SetupShot: FC = () => {
  const frame = useCurrentFrame();
  return (
    <ShotFade duration={SHOTS.setup.duration}>
      <AbsoluteFill style={{background: 'linear-gradient(145deg, #eef4ff 0%, #fbfdff 48%, #eef7ff 100%)', color: colors.ink}}>
        <div style={{position: 'absolute', left: 110, top: 72, zIndex: 5}}>
          <SmallKicker dark>低门槛配置</SmallKicker>
          <h2 style={{fontSize: 64, letterSpacing: '-0.05em', margin: '16px 0 0'}}>配置都在浏览器完成</h2>
        </div>
        {setupStates.map((state, index) => {
          const start = index * 78;
          const end = index === setupStates.length - 1 ? 390 : start + 90;
          const opacity = interpolate(frame, [start - 10, start + 12, end - 14, end], [0, 1, 1, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          const y = interpolate(frame, [start, start + 28], [28, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: ease,
          });
          return (
            <div key={state.src} style={{position: 'absolute', inset: 0, opacity, transform: `translateY(${y}px)`}}>
              <BrowserPanel style={{left: 110, right: 110, top: 190, bottom: 92}}>
                <Screenshot src={state.src} />
              </BrowserPanel>
              <div
                style={{
                  position: 'absolute',
                  left: 142,
                  bottom: 110,
                  padding: '22px 28px',
                  minWidth: 570,
                  borderRadius: 22,
                  background: 'rgba(8,18,35,0.90)',
                  color: colors.white,
                  boxShadow: '0 28px 80px rgba(18,42,88,0.28)',
                  backdropFilter: 'blur(16px)',
                }}
              >
                <div style={{fontSize: 29, fontWeight: 720}}>{state.label}</div>
                <div style={{fontSize: 20, color: '#b9c9df', marginTop: 7}}>{state.detail}</div>
              </div>
            </div>
          );
        })}
        <div style={{position: 'absolute', right: 112, top: 91, display: 'flex', gap: 12}}>
          {['运行环境', '模型', '工作区', '权限'].map((label, index) => {
            const active = Math.min(3, Math.floor(frame / 82));
            return (
              <div
                key={label}
                style={{
                  padding: '10px 16px',
                  borderRadius: 999,
                  fontSize: 18,
                  fontWeight: 650,
                  color: index <= active ? '#174bc5' : '#8794a9',
                  background: index <= active ? 'rgba(47,109,255,0.10)' : 'rgba(120,140,170,0.08)',
                }}
              >
                {label}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </ShotFade>
  );
};

const TaskShot: FC = () => {
  const frame = useCurrentFrame();
  const focus = interpolate(frame, [0, 180, 239], [0.94, 1.02, 1.07], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease,
  });
  return (
    <ShotFade duration={SHOTS.task.duration}>
      <AbsoluteFill style={{background: '#dfe9fb'}}>
        <BrowserPanel style={{inset: 42, transform: `scale(${focus})`}}>
          <OffthreadVideo
            src={staticFile('media/v4-task-submit.mp4')}
            muted
            playbackRate={1.5}
            style={{width: '100%', height: '100%', objectFit: 'cover'}}
          />
        </BrowserPanel>
        <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(7,16,31,0.9), rgba(7,16,31,0.06) 58%)'}} />
        <div style={{position: 'absolute', left: 120, top: 190, width: 690}}>
          <SmallKicker>真实任务提交</SmallKicker>
          <h2 style={{fontSize: 78, lineHeight: 1.08, letterSpacing: '-0.055em', margin: '22px 0 0'}}>
            一句任务
            <br />
            进入完整工程
          </h2>
          <p style={{fontSize: 24, color: '#b8c7db', lineHeight: 1.65, marginTop: 30}}>
            新建会话，描述目标，DeepSeek V4 Pro 开始读取真实项目。
          </p>
        </div>
        <div
          style={{
            position: 'absolute',
            right: 112,
            bottom: 82,
            opacity: interpolate(frame, [122, 154], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
          }}
        >
          <GlowPill>任务已真实提交</GlowPill>
        </div>
      </AbsoluteFill>
    </ShotFade>
  );
};

const ExecutionShot: FC = () => {
  const frame = useCurrentFrame();
  const liveOpacity = interpolate(frame, [0, 20, 188, 238], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const evidenceOpacity = interpolate(frame, [190, 235, 390, 438], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const completeOpacity = interpolate(frame, [410, 468], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease,
  });
  return (
    <ShotFade duration={SHOTS.execution.duration}>
      <AbsoluteFill style={{background: 'radial-gradient(circle at 58% 46%, #17375c 0%, #0a172a 48%, #050b15 100%)'}}>
        <div style={{position: 'absolute', inset: 44, opacity: liveOpacity}}>
          <BrowserPanel style={{inset: 0}}>
            <OffthreadVideo
              src={staticFile('media/v4-execution-rise.mp4')}
              muted
              playbackRate={1.35}
              style={{width: '100%', height: '100%', objectFit: 'cover'}}
            />
          </BrowserPanel>
        </div>
        <div style={{position: 'absolute', inset: 0, opacity: evidenceOpacity}}>
          <div style={{position: 'absolute', left: 116, top: 98}}>
            <SmallKicker>{officialModelName}</SmallKicker>
            <h2 style={{fontSize: 68, letterSpacing: '-0.05em', margin: '14px 0 0'}}>开发过程不是黑箱</h2>
          </div>
          <EvidenceCard
            src="textures/development/execution-read.png"
            title="读取代码"
            left={112}
            top={300}
            width={760}
            delay={205}
          />
          <EvidenceCard
            src="textures/development/execution-edit.png"
            title="修改文件"
            left={850}
            top={274}
            width={720}
            delay={255}
          />
          <EvidenceCard
            src="textures/development/execution-bash.png"
            title="运行验证"
            left={990}
            top={566}
            width={720}
            delay={308}
          />
          <div style={{position: 'absolute', left: 138, bottom: 92, display: 'flex', gap: 14}}>
            {['Read · 读取', 'Edit · 修改', 'Bash · 验证'].map((label) => (
              <GlowPill key={label}>{label}</GlowPill>
            ))}
          </div>
        </div>
        <div style={{position: 'absolute', inset: 0, opacity: completeOpacity}}>
          <BrowserPanel
            style={{
              left: 86,
              right: 86,
              top: 84,
              bottom: 68,
              transform: `scale(${interpolate(frame, [410, 599], [0.92, 1.01], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})})`,
            }}
          >
            <Screenshot src="textures/development/execution-complete.png" />
          </BrowserPanel>
          <div style={{position: 'absolute', left: 126, bottom: 82}}>
            <GlowPill green>已完成 · 35 项操作 · 2 个文件变化</GlowPill>
          </div>
        </div>
        <div style={{position: 'absolute', right: 84, top: 68}}>
          <GlowPill>真实执行 · 等待过程已剪辑</GlowPill>
        </div>
      </AbsoluteFill>
    </ShotFade>
  );
};

const DiffShot: FC = () => {
  const frame = useCurrentFrame();
  const titleIn = interpolate(frame, [8, 42], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease});
  const cardIn = spring({frame: frame - 98, fps: 30, config: {damping: 20, stiffness: 92}});
  return (
    <ShotFade duration={SHOTS.diff.duration}>
      <AbsoluteFill style={{background: '#dce8f8'}}>
        <PageCam
          src="textures/development/diff-page.png"
          pageH={1080}
          keys={[
            {frame: 0, cx: 1110, cy: 535, zoom: 0.96},
            {frame: 160, cx: 1390, cy: 520, zoom: 1.24},
            {frame: 299, cx: 1240, cy: 540, zoom: 1.12},
          ]}
        />
        <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(7,16,31,0.94) 0%, rgba(7,16,31,0.75) 31%, transparent 64%)'}} />
        <div style={{position: 'absolute', left: 116, top: 158, width: 640, opacity: titleIn, transform: `translateY(${(1 - titleIn) * 26}px)`}}>
          <SmallKicker>真实文件证据</SmallKicker>
          <h2 style={{fontSize: 78, lineHeight: 1.06, letterSpacing: '-0.055em', margin: '18px 0 0'}}>
            文件变化
            <br />
            已经落盘
          </h2>
          <div style={{display: 'flex', gap: 14, marginTop: 34}}>
            <GlowPill green>新增 36 行</GlowPill>
            <GlowPill>2 个文件变化</GlowPill>
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            right: 102,
            bottom: 74,
            width: 640,
            height: 338,
            opacity: cardIn,
            transform: `translateY(${(1 - cardIn) * 38}px) rotate(-1.5deg)`,
            borderRadius: 24,
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.4)',
            boxShadow: '0 34px 100px rgba(7,20,47,0.34)',
            background: '#fff',
          }}
        >
          <Screenshot src="textures/development/code-after.png" fit="cover" />
          <div style={{position: 'absolute', left: 22, top: 18}}>
            <DarkPill>Diff · 修改后</DarkPill>
          </div>
        </div>
      </AbsoluteFill>
    </ShotFade>
  );
};

const BuildShot: FC = () => {
  const frame = useCurrentFrame();
  const switchToOutput = interpolate(frame, [98, 138], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease,
  });
  return (
    <ShotFade duration={SHOTS.build.duration}>
      <AbsoluteFill style={{background: '#edf4ff'}}>
        <BrowserPanel style={{left: 62, right: 62, top: 52, bottom: 52, opacity: 1 - switchToOutput}}>
          <Screenshot src="textures/development/results-page.png" />
        </BrowserPanel>
        <BrowserPanel style={{left: 62, right: 62, top: 52, bottom: 52, opacity: switchToOutput}}>
          <Screenshot src="textures/development/verification-output.png" />
        </BrowserPanel>
        <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(0deg, rgba(7,16,31,0.92), transparent 62%)'}} />
        <div style={{position: 'absolute', left: 108, right: 108, bottom: 78, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between'}}>
          <div>
            <SmallKicker>命令输出可核对</SmallKicker>
            <h2 style={{fontSize: 66, letterSpacing: '-0.05em', margin: '14px 0 0'}}>验证结果，不靠口头承诺</h2>
          </div>
          <div style={{display: 'flex', gap: 18}}>
            <CheckSeal label="类型检查通过" command="typecheck · 退出码 0" delay={28} />
            <CheckSeal label="生产构建通过" command="build · 退出码 0" delay={82} />
          </div>
        </div>
      </AbsoluteFill>
    </ShotFade>
  );
};

const ProductShot: FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const promptIn = spring({frame: frame - 48, fps, config: {damping: 21, stiffness: 92}});
  const factsIn = spring({frame: frame - 104, fps, config: {damping: 20, stiffness: 86}});
  return (
    <ShotFade duration={SHOTS.product.duration}>
      <AbsoluteFill style={{background: 'linear-gradient(135deg, #f2f4ff 0%, #edfaff 52%, #fff4ef 100%)', color: '#09245d'}}>
        <div
          style={{
            position: 'absolute',
            left: 68,
            right: 68,
            top: 48,
            height: 170,
            borderRadius: 28,
            overflow: 'hidden',
            boxShadow: '0 26px 70px rgba(58,86,156,0.18)',
            border: '1px solid rgba(255,255,255,0.9)',
          }}
        >
          <Screenshot src="textures/product/arena-header.png" fit="cover" />
        </div>
        <div style={{position: 'absolute', left: 104, top: 276, width: 780}}>
          <SmallKicker dark>真实运行结果</SmallKicker>
          <h2 style={{fontSize: 76, lineHeight: 1.04, letterSpacing: '-0.055em', margin: '18px 0 0'}}>
            从代码
            <br />
            到运行中的产品
          </h2>
          <p style={{fontSize: 24, lineHeight: 1.7, color: '#61739a', width: 660, marginTop: 28}}>
            DeepSeek 写入的“公平评测说明”已经出现在真实应用里，并保持原有视觉与交互。
          </p>
        </div>
        <div
          style={{
            position: 'absolute',
            right: 104,
            top: 260,
            width: 790,
            height: 560,
            opacity: promptIn,
            transform: `perspective(1400px) rotateY(${-4 * promptIn}deg) translateY(${(1 - promptIn) * 44}px)`,
            borderRadius: 30,
            overflow: 'hidden',
            boxShadow: '0 42px 110px rgba(54,77,143,0.22)',
            border: '1px solid rgba(255,255,255,0.9)',
            background: '#f8fbff',
          }}
        >
          <Screenshot src="textures/product/fairness-panel.png" fit="cover" />
        </div>
        <div style={{position: 'absolute', left: 102, right: 102, bottom: 70, display: 'flex', gap: 18, opacity: factsIn}}>
          {['同一提示词', '共同参数', '单模型失败保留'].map((label) => (
            <div
              key={label}
              style={{
                flex: 1,
                padding: '25px 30px',
                borderRadius: 22,
                background: 'rgba(255,255,255,0.78)',
                border: '1px solid rgba(79,125,255,0.18)',
                boxShadow: '0 20px 48px rgba(77,97,154,0.12)',
                fontSize: 25,
                fontWeight: 720,
                color: '#174bc5',
              }}
            >
              <span style={{display: 'inline-block', width: 10, height: 10, borderRadius: 99, background: colors.mint, marginRight: 14}} />
              {label}
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </ShotFade>
  );
};

const EvaluationShot: FC = () => {
  const frame = useCurrentFrame();
  const statusOpacity = interpolate(frame, [0, 24, 118, 154], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const resultsOpacity = interpolate(frame, [118, 172], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease,
  });
  return (
    <ShotFade duration={SHOTS.evaluation.duration}>
      <AbsoluteFill style={{background: 'radial-gradient(circle at 50% 42%, #173b6e 0%, #08182d 52%, #040a13 100%)'}}>
        <div style={{position: 'absolute', left: 102, top: 76, right: 102, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', zIndex: 5}}>
          <div>
            <SmallKicker>真实双模型调用</SmallKicker>
            <h2 style={{fontSize: 70, letterSpacing: '-0.05em', margin: '14px 0 0'}}>同一提示词，两个真实模型</h2>
          </div>
          <div style={{display: 'flex', gap: 12}}>
            <GlowPill>16:9 · 各生成一张</GlowPill>
            <GlowPill green>本次费用约 0.15 美元</GlowPill>
          </div>
        </div>
        <div style={{position: 'absolute', left: 98, right: 98, top: 250, height: 470, opacity: statusOpacity}}>
          <BrowserPanel style={{inset: 0, borderRadius: 26}}>
            <OffthreadVideo
              src={staticFile('media/image-evaluation-status.mp4')}
              muted
              playbackRate={1.35}
              style={{width: '100%', height: '100%', objectFit: 'cover'}}
            />
          </BrowserPanel>
          <div style={{position: 'absolute', left: 34, bottom: 30}}>
            <DarkPill>真实运行 · 无变化等待已折叠</DarkPill>
          </div>
        </div>
        <div style={{position: 'absolute', inset: 0, opacity: resultsOpacity}}>
          <ResultImage
            src="textures/product/evaluation-result-gemini.jpg"
            model="Gemini 3 Pro Image"
            note="20.8 秒 · 真实返回"
            left={98}
            delay={130}
          />
          <ResultImage
            src="textures/product/evaluation-result-gpt.png"
            model="GPT Image 2"
            note="31.1 秒 · 真实返回"
            left={994}
            delay={168}
          />
          <div style={{position: 'absolute', left: 0, right: 0, bottom: 62, textAlign: 'center', fontSize: 24, color: '#a9bbd3'}}>
            结果并列展示，不生成自动排名
          </div>
        </div>
      </AbsoluteFill>
    </ShotFade>
  );
};

const CommandsShot: FC = () => {
  const frame = useCurrentFrame();
  const paletteIn = spring({frame: frame - 18, fps: 30, config: {damping: 20, stiffness: 88}});
  const piIn = interpolate(frame, [154, 206], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease});
  return (
    <ShotFade duration={SHOTS.commands.duration}>
      <AbsoluteFill style={{background: 'linear-gradient(135deg, #07101f, #0b2340 58%, #0a1827)'}}>
        <div style={{position: 'absolute', left: 105, top: 76}}>
          <SmallKicker>高阶工作流</SmallKicker>
          <h2 style={{fontSize: 68, letterSpacing: '-0.05em', margin: '14px 0 0'}}>熟悉的命令，仍然保留</h2>
        </div>
        <div
          style={{
            position: 'absolute',
            left: 96,
            top: 236,
            width: 1010,
            height: 422,
            opacity: paletteIn * (1 - piIn * 0.5),
            transform: `translateY(${(1 - paletteIn) * 42}px) rotate(-1deg)`,
            borderRadius: 30,
            overflow: 'hidden',
            background: '#fff',
            border: '1px solid rgba(255,255,255,0.34)',
            boxShadow: '0 44px 130px rgba(0,0,0,0.42)',
          }}
        >
          <Screenshot src="textures/commands/palette-compact.png" fit="cover" />
        </div>
        <div style={{position: 'absolute', right: 100, top: 254, width: 650, display: 'grid', gap: 16}}>
          <CommandCard command="/model" meaning="切换或核对当前模型" delay={42} />
          <CommandCard command="/compact" meaning="压缩较长的会话上下文" delay={84} />
          <CommandCard command="Skills" meaning="发现已加载的能力入口" delay={126} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: 314,
            right: 314,
            bottom: 74,
            height: 260,
            opacity: piIn,
            transform: `translateY(${(1 - piIn) * 34}px)`,
            borderRadius: 28,
            overflow: 'hidden',
            background: '#fff',
            boxShadow: '0 34px 100px rgba(0,0,0,0.34)',
          }}
        >
          <Screenshot src="textures/setup/runtime-options.png" fit="cover" />
          <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent 46%, rgba(7,16,31,0.86) 78%, rgba(7,16,31,0.96))'}} />
          <div style={{position: 'absolute', right: 38, top: 54, width: 420}}>
            <div style={{fontSize: 30, fontWeight: 760}}>也兼容 Pi Agent</div>
            <div style={{fontSize: 20, lineHeight: 1.6, color: '#b6c6db', marginTop: 12}}>兼容运行链也能发现已加载的能力。</div>
          </div>
        </div>
      </AbsoluteFill>
    </ShotFade>
  );
};

const OutroShot: FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const settle = spring({frame: frame - 8, fps, config: {damping: 18, stiffness: 76}});
  const line = interpolate(frame, [42, 92], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease});
  return (
    <ShotFade duration={SHOTS.outro.duration} fadeOut={0}>
      <AbsoluteFill style={{background: 'radial-gradient(circle at 50% 42%, #153f72 0%, #08182c 47%, #040910 100%)', display: 'grid', placeItems: 'center'}}>
        <div style={{textAlign: 'center', transform: `translateY(${(1 - settle) * 32}px)`, opacity: settle}}>
          <Img src={staticFile('textures/brand/ff-logo.png')} style={{width: 86, height: 86, borderRadius: 18, marginBottom: 30}} />
          <div style={{fontSize: 30, color: '#9db4d2', letterSpacing: '0.03em'}}>{officialProductName}</div>
          <div style={{fontSize: 78, fontWeight: 760, letterSpacing: '-0.055em', marginTop: 18}}>让 DeepSeek 真正进入项目</div>
          <div style={{height: 3, width: `${260 * line}px`, margin: '34px auto 0', background: `linear-gradient(90deg, ${colors.blue}, ${colors.cyan})`, borderRadius: 99}} />
          <div style={{fontSize: 24, color: '#9eb2cb', marginTop: 28}}>配置 · 开发 · 验证 · 真实运行</div>
        </div>
      </AbsoluteFill>
    </ShotFade>
  );
};

const ShotFade: FC<{children: ReactNode; duration: number; fadeIn?: number; fadeOut?: number}> = ({children, duration, fadeIn = 12, fadeOut = 12}) => {
  const frame = useCurrentFrame();
  const inOpacity = fadeIn === 0
    ? 1
    : interpolate(frame, [0, Math.max(1, fadeIn)], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const outOpacity = fadeOut === 0
    ? 1
    : interpolate(frame, [duration - fadeOut, duration - 1], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const opacity = inOpacity * outOpacity;
  return <AbsoluteFill style={{opacity}}>{children}</AbsoluteFill>;
};

const BrowserPanel: FC<{children: ReactNode; style?: CSSProperties}> = ({children, style}) => (
  <div
    style={{
      position: 'absolute',
      borderRadius: 30,
      overflow: 'hidden',
      background: '#fff',
      border: '1px solid rgba(255,255,255,0.46)',
      boxShadow: '0 44px 120px rgba(8,24,55,0.30)',
      ...style,
    }}
  >
    {children}
  </div>
);

const Screenshot: FC<{src: string; fit?: 'cover' | 'contain'}> = ({src, fit = 'cover'}) => (
  <Img src={staticFile(src)} style={{width: '100%', height: '100%', objectFit: fit, display: 'block'}} />
);

const BrandLine: FC = () => (
  <div style={{display: 'flex', alignItems: 'center', gap: 20}}>
    <Img src={staticFile('textures/brand/ff-logo.png')} style={{width: 58, height: 58, borderRadius: 12}} />
    <div>
      <div style={{fontSize: 24, fontWeight: 720}}>{officialProductName}</div>
      <div style={{fontSize: 17, color: '#93a9c3', marginTop: 4}}>官方 DeepSeek Harness 可视化工作台</div>
    </div>
  </div>
);

const SmallKicker: FC<{children: ReactNode; dark?: boolean}> = ({children, dark = false}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      fontSize: 19,
      fontWeight: 720,
      color: dark ? '#245bd5' : colors.cyan,
      letterSpacing: '0.12em',
    }}
  >
    <span style={{width: 8, height: 8, borderRadius: 99, background: dark ? colors.blue : colors.mint, boxShadow: `0 0 22px ${dark ? colors.blue : colors.mint}`}} />
    {children}
  </div>
);

const GlowPill: FC<{children: ReactNode; green?: boolean}> = ({children, green = false}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      padding: '12px 17px',
      borderRadius: 999,
      background: green ? 'rgba(61,201,145,0.15)' : 'rgba(91,159,255,0.15)',
      border: `1px solid ${green ? 'rgba(98,221,181,0.42)' : 'rgba(106,188,255,0.38)'}`,
      color: green ? '#a5f4d6' : '#cae7ff',
      fontSize: 18,
      fontWeight: 680,
      backdropFilter: 'blur(14px)',
      boxShadow: green ? '0 0 36px rgba(98,221,181,0.12)' : '0 0 36px rgba(47,109,255,0.12)',
    }}
  >
    <span style={{width: 7, height: 7, borderRadius: 99, background: green ? colors.mint : colors.cyan}} />
    {children}
  </div>
);

const DarkPill: FC<{children: ReactNode}> = ({children}) => (
  <div style={{display: 'inline-flex', padding: '10px 14px', borderRadius: 999, background: 'rgba(5,13,26,0.84)', color: '#dcecff', fontSize: 17, fontWeight: 700, backdropFilter: 'blur(12px)'}}>
    {children}
  </div>
);

const EvidenceCard: FC<{src: string; title: string; left: number; top: number; width: number; delay: number}> = ({src, title, left, top, width, delay}) => {
  const frame = useCurrentFrame();
  const show = spring({frame: frame - delay, fps: 30, config: {damping: 18, stiffness: 92}});
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width,
        minHeight: 144,
        padding: 18,
        borderRadius: 24,
        background: 'rgba(242,248,255,0.94)',
        border: '1px solid rgba(145,196,255,0.42)',
        boxShadow: '0 32px 90px rgba(0,0,0,0.30)',
        opacity: show,
        transform: `translateY(${(1 - show) * 44}px) scale(${0.92 + show * 0.08})`,
      }}
    >
      <div style={{fontSize: 18, color: '#2f6dff', fontWeight: 760, margin: '0 4px 12px'}}>{title}</div>
      <Img src={staticFile(src)} style={{display: 'block', width: '100%', maxHeight: 430, objectFit: 'contain', objectPosition: 'left top', borderRadius: 15}} />
    </div>
  );
};

const CheckSeal: FC<{label: string; command: string; delay: number}> = ({label, command, delay}) => {
  const frame = useCurrentFrame();
  const show = spring({frame: frame - delay, fps: 30, config: {damping: 18, stiffness: 104}});
  return (
    <div
      style={{
        width: 290,
        padding: '22px 24px',
        borderRadius: 22,
        background: 'rgba(15,30,50,0.86)',
        border: '1px solid rgba(98,221,181,0.34)',
        boxShadow: '0 24px 70px rgba(0,0,0,0.30)',
        opacity: show,
        transform: `translateY(${(1 - show) * 28}px)`,
      }}
    >
      <div style={{display: 'flex', alignItems: 'center', gap: 12, fontSize: 23, fontWeight: 750}}>
        <span style={{display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 99, background: colors.mint, color: '#07211b', fontSize: 18}}>✓</span>
        {label}
      </div>
      <div style={{fontFamily: mono, fontSize: 15, color: '#9fb2c9', marginTop: 12}}>{command}</div>
    </div>
  );
};

const ResultImage: FC<{src: string; model: string; note: string; left: number; delay: number}> = ({src, model, note, left, delay}) => {
  const frame = useCurrentFrame();
  const show = spring({frame: frame - delay, fps: 30, config: {damping: 20, stiffness: 82}});
  const drift = interpolate(frame, [delay, 419], [1, 1.045], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease});
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top: 248,
        width: 828,
        opacity: show,
        transform: `translateY(${(1 - show) * 56}px) rotate(${left < 500 ? -1.1 : 1.1}deg)`,
      }}
    >
      <div style={{height: 466, borderRadius: 28, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.32)', boxShadow: '0 42px 120px rgba(0,0,0,0.48)', background: '#12243c'}}>
        <Img src={staticFile(src)} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${drift})`}} />
      </div>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '22px 6px 0'}}>
        <div style={{fontSize: 26, fontWeight: 740}}>{model}</div>
        <div style={{fontSize: 18, color: '#91a9c5'}}>{note}</div>
      </div>
    </div>
  );
};

const CommandCard: FC<{command: string; meaning: string; delay: number}> = ({command, meaning, delay}) => {
  const frame = useCurrentFrame();
  const show = spring({frame: frame - delay, fps: 30, config: {damping: 19, stiffness: 92}});
  return (
    <div
      style={{
        padding: '23px 26px',
        borderRadius: 22,
        background: 'rgba(244,249,255,0.09)',
        border: '1px solid rgba(130,190,255,0.23)',
        backdropFilter: 'blur(16px)',
        opacity: show,
        transform: `translateX(${(1 - show) * 44}px)`,
      }}
    >
      <div style={{fontFamily: mono, fontSize: 30, fontWeight: 760, color: colors.cyan}}>{command}</div>
      <div style={{fontSize: 19, color: '#aebed2', marginTop: 8}}>{meaning}</div>
    </div>
  );
};

const AmbientField: FC = () => {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [0, 3060], [-180, 280], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          width: 780,
          height: 780,
          borderRadius: 999,
          left: 260 + x,
          top: -420,
          background: 'radial-gradient(circle, rgba(47,109,255,0.19), transparent 68%)',
          filter: 'blur(18px)',
        }}
      />
    </AbsoluteFill>
  );
};

const FilmFinish: FC = () => (
  <AbsoluteFill
    style={{
      pointerEvents: 'none',
      backgroundImage:
        'repeating-linear-gradient(0deg, rgba(255,255,255,0.012) 0px, rgba(255,255,255,0.012) 1px, transparent 1px, transparent 4px), radial-gradient(circle at 50% 48%, transparent 55%, rgba(0,0,0,0.34) 100%)',
      mixBlendMode: 'soft-light',
      opacity: 0.82,
    }}
  />
);
