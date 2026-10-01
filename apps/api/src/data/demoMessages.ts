import type {Platform} from '@casebee/shared';

export interface DemoMessageInput {
  id: string;
  platform: Platform;
  senderId: string;
  senderName: string;
  text: string;
  threadId: string;
}

export const demoMessages: DemoMessageInput[] = [
  {
    id: 'demo-inquiry-logo',
    platform: 'LINE',
    senderId: 'line-demo-wang',
    senderName: '王小明',
    text: '你好，想詢問 Logo + 名片設計費用，預算 12000，月底前完成可以嗎？',
    threadId: 'demo-thread-wang-logo',
  },
  {
    id: 'demo-quote-video-urgent',
    platform: 'Gmail',
    senderId: 'marketing@example.com',
    senderName: '晴天行銷',
    text: 'Subject: Reels 影片報價詢問\n\n我們想做一支 Reels 影片，預算 8000，明天前需要初版，請問可以接嗎？',
    threadId: 'demo-thread-sunny-reels',
  },
  {
    id: 'demo-confirm-website',
    platform: 'Gmail',
    senderId: 'contact@foresttech.test',
    senderName: '森木科技',
    text: '網站重新設計的提案我們確認可以合作，請問下週可以簽約嗎？',
    threadId: 'demo-thread-forest-site',
  },
  {
    id: 'demo-scope-change-post',
    platform: 'LINE',
    senderId: 'line-demo-cafe',
    senderName: '小島咖啡',
    text: 'IG 貼文設計那 3 張可以順便幫我改成 5 張嗎？本週想先看到方向。',
    threadId: 'demo-thread-island-posts',
  },
  {
    id: 'demo-missing-fields-brand',
    platform: 'Manual',
    senderId: 'manual-goodlife',
    senderName: '美好生活品牌',
    text: '看到你的作品集，想聊品牌合作，不確定形式但想先了解看看。',
    threadId: 'demo-thread-goodlife-brand',
  },
  {
    id: 'demo-material-risk-photo',
    platform: 'LINE',
    senderId: 'line-demo-zhao',
    senderName: '趙老闆',
    text: '產品攝影素材我下週才能給你，後天的交件可能來不及。',
    threadId: 'demo-thread-zhao-photo',
  },
];
