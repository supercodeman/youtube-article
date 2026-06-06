import { YoutubeTranscript } from 'youtube-transcript';
import type { SubtitleSource } from '../types';

export interface SubtitleResult {
  subtitles: string;
  source: SubtitleSource;
}

// 演示视频字幕（作为 fallback 兜底）
const DEMO_SUBTITLES = `[00:00] 今天我们要讨论一个价值万亿美元的问题
[00:15] 这就是 AI 革命的核心
[00:30] 我们看到 AI 行业正在经历前所未有的增长
[00:45] 收入正在爆发，成本正在塌陷
[01:00] 这是什么意思呢
[01:15] 意味着 AI 可以为企业和个人创造巨大价值
[01:30] 首先是消费者 AI 市场
[01:45] 然后是企业 AI 市场
[02:00] 最后是云服务和数据中心基础设施
[02:15] 我们看到 GPU 和数据中心供给正在改善
[02:30] 这将进一步扩大需求
[02:45] 十年内，AI 将无处不在

[03:00] 收入增长的关键在于几个方面
[03:15] 首先是消费者订阅模式
[03:30] 人们愿意为 AI 助手付费
[03:45] 这是一个新的市场
[04:00] 其次是企业市场
[04:15] 企业愿意为提高效率付费
[04:30] 按需付费的模式很灵活
[04:45] 基于价值的定价也越来越流行
[05:00] 这些都是健康的商业模式

[05:15] 成本塌陷同样重要
[05:30] GPU 价格在下降
[05:45] 数据中心效率在提升
[06:00] 这意味着更多人可以负担得起
[06:15] 需求会进一步扩大
[06:30] 这是一个正向循环
[06:45] 收入增长，成本下降
[07:00] 更多创新随之而来

[07:15] 我们还要考虑地域分布
[07:30] 亚洲市场增长迅速
[07:45] 欧洲市场也在快速发展
[08:00] 美国市场依然领先
[08:15] 但竞争格局在变化
[08:30] 未来会有更多元化的竞争者

[09:00] 技术进步的速度令人惊讶
[09:15] 五年前我们无法想象今天的状态
[09:30] 下一个五年会是什么样
[09:45] 我相信会更加激动人心
[10:00] AI 将渗透到每个行业
[10:15] 每个企业都需要思考如何拥抱 AI
[10:30] 这不是选择，而是必须

[11:00] 最后让我们谈谈人才
[11:15] AI 人才供不应求
[11:30] 培养下一代是关键
[11:45] 开源和教育的机会巨大
[12:00] 我们期待看到更多创新`;

/**
 * 智能字幕获取策略：
 * 1. 有 manual → 用 manual
 * 2. 没 manual → 尝试 youtube-transcript 实时抓取
 *    2a. 先试 zh-CN（用户首选）
 *    2b. 失败降级到不带 lang（让 YouTube 给默认轨）
 * 3. youtube-transcript 全部失败 → 用演示视频字幕（兜底）
 * 4. 都没有 → 返回空，让上层报错
 */
export async function getSubtitles(
  videoId: string,
  manualSubtitles?: string
): Promise<SubtitleResult> {
  // Level 1: 用户手动粘贴
  if (manualSubtitles && manualSubtitles.trim()) {
    return {
      subtitles: manualSubtitles.trim(),
      source: 'manual'
    };
  }

  // Level 2a: 优先尝试 zh-CN（用户首选）
  try {
    const items = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'zh-CN' });
    if (items && items.length > 0) {
      const formatted = items
        .map(item => `[${formatTime(item.offset)}] ${item.text}`)
        .join('\n');
      return { subtitles: formatted, source: 'manual' };
    }
  } catch (e) {
    // 没中文轨，降级到 Level 2b
  }

  // Level 2b: 不带 lang，让 YouTube 给默认轨（en / auto-generated）
  try {
    const items = await YoutubeTranscript.fetchTranscript(videoId);
    if (items && items.length > 0) {
      const formatted = items
        .map(item => `[${formatTime(item.offset)}] ${item.text}`)
        .join('\n');
      return { subtitles: formatted, source: 'manual' };
    }
  } catch (e) {
    // 静默失败：fallback 到演示视频字幕
  }

  // Level 3: 演示视频字幕兜底
  if (DEMO_SUBTITLES) {
    return { subtitles: DEMO_SUBTITLES, source: 'fallback' };
  }

  // Level 4: 返回空（让上层报错）
  return { subtitles: '', source: 'fallback' };
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `[${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}]`;
}