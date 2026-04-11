import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';

const db = new Database(join(homedir(), '.banini-tracker', 'banini.db'));
const now = new Date().toISOString();

const insert = db.prepare(`
  INSERT OR IGNORE INTO predictions
    (post_id, post_url, symbol_name, symbol_code, symbol_type,
     her_action, reverse_view, confidence, reasoning,
     base_price, created_at, recorded_at, status)
  VALUES
    (?, ?, ?, NULL, ?, ?, ?, '', ?, NULL, ?, ?, 'tracking')
`);

const predictions = [
  ['fb_1022175019267093', 'https://www.facebook.com/DieWithoutBang/posts/pfbid0C4p2vp9mfg3W2tCZr3RZuqcrDaCJ7VVLNdsKf1ufnU9iiYeULYmRkm2dNG3FJdKel', '仁寶', '個股', '看空', '多', '星期一要崩了仁寶', '2024-06-02T11:49:43.000Z'],
  ['fb_1022361429248452', 'https://www.facebook.com/DieWithoutBang/posts/pfbid0XF1PQnNaBahjTWW2a5YL6DzGXZCLPf9az1oSTCDJ2EbbLRhuzyW6AxuKhfX5DSBMl', '仁寶', '個股', '計畫放空', '多', '明天空仁寶了', '2024-06-02T18:09:26.000Z'],
  ['fb_1022509355900326', 'https://www.facebook.com/DieWithoutBang/posts/pfbid02ZFKG4duVJfC3fkSoQna4vXM9XJcKVz5zNnagEJfU14zmh4oM3TQgX8T99UmDG454l', '未知（原文稱老AI）', '個股', '看多', '空', '老AI都活了=看多', '2024-06-03T01:20:09.000Z'],
  ['fb_1022524935898768', 'https://www.facebook.com/DieWithoutBang/posts/pfbid02wPJGGAggJq5MApGYWGbXG6c1dqRycVTeYenbSFJNbQwM5aFtq5Y6YBNPqLZtLugtl', '未知（原文稱泥巴）', '個股', '看空', '多', '泥巴扶不上牆轉控股感覺要掰了', '2024-06-03T02:01:28.000Z'],
  ['fb_1023403852477543', 'https://www.facebook.com/DieWithoutBang/posts/pfbid0mTYX2AG7DQpjnE8uYCrkN3ZsdFmZ5nP6fQq1WM2y1RoHCUSWtrfJQz4fxSiJHcAzl', '大盤', '指數', '看多', '空', '今天跌明天漲=看多大盤', '2024-06-04T14:51:00.000Z'],
  ['fb_1023648965786365', 'https://www.facebook.com/DieWithoutBang/posts/pfbid02HJrMBpSApWq3eF3pcMT4Gbsfj5GWX9Fu1L7ffbaZvPBwjaXigtqB5F3ytwhbsyGCl', '大盤', '指數', '看多', '空', '台股什麼是崩盤=看多', '2024-06-05T01:02:29.000Z'],
  ['fb_1023750365776225', 'https://www.facebook.com/reel/1206890047159708/', '大立光', '個股', '被套', '空', '2017買的大立光到現在還沒解套', '2024-06-05T05:09:52.000Z'],
  ['fb_1024255979058997', 'https://www.facebook.com/DieWithoutBang/posts/pfbid0fGnh5AKMgRckJfziTxh7Azu6RDcRhxTWyzfpmdMn6heCBVZzsmYRM6PnfdoQC9cul', '未知（原文稱兩位AI好朋友）', '個股', '被套', '空', '兩位AI好朋友是怎樣=持有中虧損', '2024-06-06T02:17:05.000Z'],
  ['fb_1024535035697758', 'https://www.facebook.com/DieWithoutBang/posts/pfbid0GLcJWfeQ9AtTJnzRxx3nFGy2T1xojoQYdxoNs6hKeKKHMuCaKCGtCk9sZ5o2Gxtzl', 'Apple', '個股', '看多', '空', 'Apple跟OpenAI合作ARM架構在AI有優勢股價可期', '2024-06-06T13:37:04.000Z'],
  ['fb_1024535035697758', 'https://www.facebook.com/DieWithoutBang/posts/pfbid0GLcJWfeQ9AtTJnzRxx3nFGy2T1xojoQYdxoNs6hKeKKHMuCaKCGtCk9sZ5o2Gxtzl', 'Intel', '個股', '看空', '多', 'Intel前有Nvidia後有Qualcomm有點危', '2024-06-06T13:37:04.000Z'],
  ['fb_1024535035697758', 'https://www.facebook.com/DieWithoutBang/posts/pfbid0GLcJWfeQ9AtTJnzRxx3nFGy2T1xojoQYdxoNs6hKeKKHMuCaKCGtCk9sZ5o2Gxtzl', '台積電', '個股', '看多', '空', 'TSMC繼續稱神N3B N6訂單穩到不行', '2024-06-06T13:37:04.000Z'],
  ['fb_1024847212333207', 'https://www.facebook.com/DieWithoutBang/posts/pfbid02C43fDQcHaZTtzHz8hqWjBCahvGsRxwimg447hESCbQHAPTGEPmGNDChbEJAvT89kl', '台積電', '個股', '看多', '空', '昨天晚上大力讚揚的GG結果跌', '2024-06-07T02:39:49.000Z'],
  ['fb_1024847212333207', 'https://www.facebook.com/DieWithoutBang/posts/pfbid02C43fDQcHaZTtzHz8hqWjBCahvGsRxwimg447hESCbQHAPTGEPmGNDChbEJAvT89kl', '英業達', '個股', '看多', '空', '週末說好棒棒的英業達結果跌', '2024-06-07T02:39:49.000Z'],
  ['fb_1024847212333207', 'https://www.facebook.com/DieWithoutBang/posts/pfbid02C43fDQcHaZTtzHz8hqWjBCahvGsRxwimg447hESCbQHAPTGEPmGNDChbEJAvT89kl', '緯創', '個股', '看多', '空', '週末說好棒棒的緯創結果跌', '2024-06-07T02:39:49.000Z'],
  ['fb_1025135682304360', 'https://www.facebook.com/DieWithoutBang/posts/pfbid0shuKjNqDhquDEua6c4miqCD1mpAbzUM82TcjpN5NhfJABPEQovodVLJXsn7VoNEZl', '金融', '產業', '看多', '空', '我大金融果然天下無敵', '2024-06-07T13:57:47.000Z'],
  ['fb_1026404712177457', 'https://www.facebook.com/DieWithoutBang/posts/pfbid0grrQn1ZNJEhT6MTo87abVepRrPv5WjEosNj7hgLrFG59PZFWswPXk77L674uCgaml', '大盤', '指數', '看多', '空', '早上台股一定不會跌了', '2024-06-09T17:30:56.000Z'],
  ['fb_1026747295476532', 'https://www.facebook.com/DieWithoutBang/posts/pfbid02XE4vj3Hbuqtk7y2rhZM6YKVWoPEMybC1dxvq72Ys3fcGkTS1judvuQdhzDJE3LTl', '大盤', '指數', 'All in', '空', 'GPT神諭明天All In了', '2024-06-10T09:05:02.000Z'],
  ['fb_1026994512118477', 'https://www.facebook.com/DieWithoutBang/posts/pfbid0YfgNCChxxcHMUgyu14xxD9JU6aZuZp5g1prLaWWC8mKvB6ATcEP63Zxp5jhntx69l', 'Apple', '個股', '看空', '多', '這個蘋果爛了賣一賣吧', '2024-06-10T18:06:18.000Z'],
  ['fb_1027194485431813', 'https://www.facebook.com/DieWithoutBang/posts/pfbid023Sr4yn5NAG8aZ7fjDTmd6hPSxfjQEtjkSXvzuWvHbTmAxv54psc6o5dNtcwF9JP6l', '大盤', '指數', '看空', '多', '覺得到頭了應該要拉回整理', '2024-06-11T03:30:37.000Z'],
  ['fb_1028289468655648', 'https://www.facebook.com/DieWithoutBang/posts/pfbid02HKqP4ssF1kzMTPz3L5HEL1XqRSQnJdNj1QzKRoTsWxy33dmPMFoCmCHhjWYwxV8fl', '未知（追價追到了）', '個股', '買入', '空', '買不到一直追價追到了=買入', '2024-06-13T01:52:32.000Z'],
  ['fb_1028855638599031', 'https://www.facebook.com/DieWithoutBang/posts/pfbid02wu7VmVj9kgiRatocAabVzEMfTVEUom5r2MPA5TGgMS3qVuk1X62UknbdssEz1wsfl', '鴻海', '個股', '看多', '空', '鴻海要漲回來了', '2024-06-14T01:29:49.000Z'],
  ['fb_1028952205256041', 'https://www.facebook.com/DieWithoutBang/posts/pfbid033fd8jW7wBuk7vHhu1w2sncqtRLdvZMKdrWDwxRn6M78igWKiE85CBvLbYnFsSfdgl', '台積電', '個股', '看多', '空', '我大台積天下無敵', '2024-06-14T05:29:15.000Z'],
  ['fb_1029104415240820', 'https://www.facebook.com/DieWithoutBang/posts/pfbid033CDEDQ3QKybzMDcFua59JfVeq2wzicswPG6groEBf2aMfV249iwPaMVMdTuMfuCZl', '鴻海', '個股', '看多', '空', '先慶祝鴻海有賺錢', '2024-06-14T11:51:49.000Z'],
  ['fb_1029752685175993', 'https://www.facebook.com/DieWithoutBang/posts/pfbid02SRsAvn1ZgRv1k3utgt3JmfhQ1WGh8ekz5hkXx6btGpNtsfq61zJn2cA1Gj7aipFhl', 'NVIDIA', '個股', '看多', '空', '一直沒買Nvidia已經看了1個月=觀望想買', '2024-06-15T14:30:13.000Z'],
  ['fb_1030593431758585', 'https://www.facebook.com/DieWithoutBang/posts/pfbid02Pgra8TUc8j2Aw78RBcu3h6S6ngAij7Utj1EiajyzAed5ZqqQcahXeu8QHiJuR9CMl', '大盤', '指數', '看多', '空', '準備好迎接漲爛的一天嗎', '2024-06-17T00:08:56.000Z'],
];

let inserted = 0;
for (const p of predictions) {
  const result = insert.run(...p, now);
  if (result.changes > 0) inserted++;
}
console.log('寫入 ' + inserted + '/' + predictions.length + ' 筆');
const count = db.prepare('SELECT COUNT(*) as c FROM predictions').get();
console.log('predictions 表共 ' + count.c + ' 筆');
