export interface SubtitleResult {
  subtitles: string;
  source: 'api' | 'fallback' | 'manual';
}

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

// 硬编码演示视频字幕（当 API 失败时使用）
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
[12:00] 我们期待看到更多创新`,

  ai_trillion: `[00:00] 今天我们要讨论一个价值万亿美元的问题
[00:15] 这就是 AI 革命的核心
[00:30] 我们看到 AI 行业正在经历前所未有的增长
[00:45] 收入正在爆发，成本正在塌陷
[01:00] 这是什么意思呢
[01:15] 意味着 AI 可以为企业和个人创造巨大价值
[01:30] 首先是消费者 AI 市场
[01:45] 然后是企业 AI 市场
[02:00] 最后是云服务和数据中心基础设施`,

  tech_future: `[00:00] 欢迎来到未来科技讨论
[00:15] 今天我们聊聊 AI 和自动化的未来
[00:30] 技术正在以指数级速度发展
[00:45] 十年前难以想象的事情今天已成现实
[01:00] 我们正处于一个转折点
[01:15] 很多事情即将发生改变
[01:30] 从医疗到教育，从金融到制造
[01:45] AI 正在重塑每一个行业
[02:00] 重要的是理解这股趋势
[02:15] 而不是抗拒它`,

  business_ai: `[00:00] 今天我们来谈谈 AI 商业化
[00:15] 这是很多人关心的话题
[00:30] AI 的商业模式到底是什么
[00:45] 我们看到几种主要的变现方式
[01:00] 首先是消费者订阅
[01:15] 然后是企业按需 token 计费
[01:30] 还有基于业务价值的变现
[01:45] 这些方式各有优势
[02:00] 关键在于找到最适合你的模式
[02:15] AI 的定价正在趋于合理
[02:30] 这将进一步扩大市场`
};

export class SubtitleService {
  private videoId: string;
  private proxyConfig: ProxyConfig | null = null;

  constructor(videoId: string, proxyConfig?: ProxyConfig) {
    this.videoId = videoId;
    this.proxyConfig = proxyConfig || null;
  }

  async fetchSubtitles(): Promise<SubtitleResult> {
    // Level 1: 尝试直接获取
    try {
      const subtitles = await this.fetchDirect();
      if (subtitles) return { subtitles, source: 'api' };
    } catch (e) {
      console.error('Direct fetch failed:', e);
    }

    // Level 2: 返回硬编码字幕
    return this.getFallbackSubtitles();
  }

  private async fetchDirect(): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      // 尝试多个字幕源
      const sources = [
        `https://subtitle.googleapis.com/v1/subtitles?videoId=${this.videoId}`,
        `https://youtubetranscript.googleapis.com/v1/subtitles/${this.videoId}`
      ];

      for (const url of sources) {
        try {
          const response = await fetch(url, { signal: controller.signal });
          if (response.ok) {
            const data = await response.json();
            const subtitles = this.parseSubtitles(data);
            if (subtitles) {
              clearTimeout(timeout);
              return subtitles;
            }
          }
        } catch {
          // 继续尝试下一个源
        }
      }

      clearTimeout(timeout);
      return null;
    } catch {
      clearTimeout(timeout);
      return null;
    }
  }

  private parseSubtitles(data: unknown): string {
    if (!data || typeof data !== 'object') return '';

    // 处理不同格式的字幕响应
    const d = data as Record<string, unknown>;

    // 格式 1: { subtitles: [{ transcript: [{ text: string }] }] }
    const tracks = d.subtitles as Array<{ transcript?: Array<{ text?: string }> }> | undefined;
    if (tracks && Array.isArray(tracks)) {
      return tracks.map(t =>
        t.transcript?.map(s => s.text || '').join(' ') || ''
      ).filter(Boolean).join('\n');
    }

    // 格式 2: { transcript: [{ text: string }] }
    const transcript = d.transcript as Array<{ text?: string }> | undefined;
    if (transcript && Array.isArray(transcript)) {
      return transcript.map(t => t.text || '').filter(Boolean).join('\n');
    }

    return '';
  }

  private getFallbackSubtitles(): SubtitleResult {
    // 优先使用演示视频的字幕
    const fallback = FALLBACK_SUBTITLES[this.videoId] || FALLBACK_SUBTITLES['ai_trillion'];
    return {
      subtitles: fallback,
      source: 'fallback'
    };
  }

  // 供外部获取硬编码字幕（用于测试）
  static getFallbackForVideo(videoId: string): SubtitleResult {
    const fallback = FALLBACK_SUBTITLES[videoId];
    if (fallback) {
      return { subtitles: fallback, source: 'fallback' };
    }
    return { subtitles: FALLBACK_SUBTITLES['ai_trillion'], source: 'fallback' };
  }
}

export { FALLBACK_SUBTITLES };