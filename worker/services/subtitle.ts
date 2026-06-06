import type { SubtitleSource } from '../types';

export interface SubtitleResult {
  subtitles: string;
  source: SubtitleSource;
}

// 硬编码字幕池
// 注意：这是演示用途的 fallback，实际应该从 YouTube 提取
const FALLBACK_SUBTITLES: Record<string, string> = {
  'xRh2sVcNXQ8': `对话安德森：AI革命的万亿美金之问

[00:00] 今天我们要讨论一个价值万亿美元的问题
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
[12:00] 我们期待看到更多创新`
};

export function getSubtitles(videoId: string, manualSubtitles?: string): SubtitleResult {
  // 优先使用用户手动粘贴的字幕
  if (manualSubtitles && manualSubtitles.trim()) {
    return {
      subtitles: manualSubtitles.trim(),
      source: 'manual'
    };
  }

  // fallback 到硬编码字幕
  const fallback = FALLBACK_SUBTITLES[videoId];
  if (fallback) {
    return {
      subtitles: fallback,
      source: 'fallback'
    };
  }

  // 没有匹配时返回空
  return {
    subtitles: '',
    source: 'fallback'
  };
}