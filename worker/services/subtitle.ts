// 硬编码示例字幕池（当 API 失败时使用）
const FALLBACK_SUBTITLES: Record<string, string> = {
  ai_trillion: `[00:00] 今天我们要讨论一个价值万亿美元的问题
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
[02:45] 十年内，AI 将无处不在`,

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

  constructor(videoId: string) {
    this.videoId = videoId;
  }

  async fetchSubtitles(): Promise<{ subtitles: string; source: 'api' | 'fallback' }> {
    // Level 1: 尝试直接获取
    try {
      const subtitles = await this.fetchDirect();
      if (subtitles) return { subtitles, source: 'api' };
    } catch (e) {
      console.error('Level 1 failed:', e);
    }

    // Level 2: 尝试第三方 API（可用时实现）
    try {
      const subtitles = await this.fetchThirdParty();
      if (subtitles) return { subtitles, source: 'api' };
    } catch (e) {
      console.error('Level 2 failed:', e);
    }

    // Level 3: 返回示例字幕
    return this.getFallbackSubtitles();
  }

  private async fetchDirect(): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(
        `https://subtitle.googleapis.com/v1/subtitles?videoId=${this.videoId}`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);

      if (!response.ok) return null;
      const data = await response.json();
      return this.parseSubtitles(data);
    } catch {
      clearTimeout(timeout);
      return null;
    }
  }

  private async fetchThirdParty(): Promise<string | null> {
    // 第三方字幕 API（预留接口，可用时实现）
    return null;
  }

  private parseSubtitles(data: unknown): string {
    if (!data || typeof data !== 'object') return '';
    const d = data as Record<string, unknown>;
    const tracks = d.subtitles as Array<{ transcript: Array<{ text: string }> }> | undefined;
    if (!tracks || !Array.isArray(tracks)) return '';
    return tracks.map(t => t.transcript?.map(s => s.text).join(' ') || '').filter(Boolean).join('\n');
  }

  private getFallbackSubtitles(): { subtitles: string; source: 'fallback' } {
    const keys = Object.keys(FALLBACK_SUBTITLES);
    const randomKey = keys[Math.floor(Math.random() * keys.length)];
    return {
      subtitles: FALLBACK_SUBTITLES[randomKey],
      source: 'fallback'
    };
  }
}