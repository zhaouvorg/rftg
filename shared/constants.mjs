export const MSG = Object.freeze({ LOGIN:1, HELLO:2, DENIED:3, GOODBYE:4, PING:5,
  PLAYER_NEW:10, PLAYER_LEFT:11, OPENGAME:20, GAME_PLAYER:21, CLOSE_GAME:22,
  JOIN:23, LEAVE:24, JOINACK:25, JOINNAK:26, CREATE:27, START:28, REMOVE:29,
  RESIGN:30, ADD_AI:31, STATUS_META:40, STATUS_PLAYER:41, STATUS_CARD:42,
  STATUS_GOAL:43, STATUS_MISC:44, LOG:45, CHAT:46, WAITING:47, SEAT:48,
  GAMECHAT:49, LOG_FORMAT:50, STATUS_ORB:51, STATUS_XCS:52, CHOOSE:60, PREPARE:61, GAMEOVER:70 });
export const CHOICE_NAMES = ['行动','起始世界','弃牌','保存卡牌','弃牌获得威望','放置卡牌','支付费用','殖民行动','夺取世界','防御','阻止夺取','升级世界','交易货物','消费能力','消费手牌','选择货物','幸运数字','赌博下注','保留卡牌','生产横置货物','生产能力','弃牌生产','搜索类别','搜索结果','货物类型','援助防御','修复世界','修复方式','修复货物','修复能力','防御能力','手牌军力','掩体','损伤世界','确认防御','Orb 行动','移动目标','返回气闸','打出 Orb 卡','放置 Orb 卡','起始气闸','使用神器','神器支付','小气闸','临时军力','军力货物','选择调查队','放置异星货物','边境世界','边境牌堆','特殊行动','选择征服路线','征服决定','边境确认','防御结果'];
export const ACTIONS = [
  {id:0,name:'搜索',en:'SEARCH',icon:'⌕',hint:'使用一次性的搜索行动',color:'#ba94e6'},
  {id:1,name:'探索 +5',en:'EXPLORE',icon:'Ⅰ',hint:'多看 5 张，保留 1 张',color:'#79afec'},
  {id:2,name:'探索 +1/+1',en:'EXPLORE',icon:'Ⅰ',hint:'多看 1 张，多留 1 张',color:'#79afec'},
  {id:3,name:'发展',en:'DEVELOP',icon:'Ⅱ',hint:'建造发展牌，费用减 1',color:'#e6c686'},
  {id:4,name:'再次发展',en:'DEVELOP II',icon:'Ⅱ',hint:'第二个发展阶段',color:'#e6c686'},
  {id:5,name:'殖民',en:'SETTLE',icon:'Ⅲ',hint:'放置世界，成功后抽 1 张',color:'#c7df92'},
  {id:6,name:'再次殖民',en:'SETTLE II',icon:'Ⅲ',hint:'第二个殖民阶段',color:'#c7df92'},
  {id:7,name:'消费：交易',en:'TRADE',icon:'Ⅳ',hint:'先出售一件货物换取手牌',color:'#dba2d6'},
  {id:8,name:'消费 ×2',en:'CONSUME',icon:'Ⅳ',hint:'消费获得的胜利点翻倍',color:'#dba2d6'},
  {id:9,name:'生产',en:'PRODUCE',icon:'Ⅴ',hint:'生产货物，额外生产一件横置货物',color:'#72d7c4'},
  {id:10,name:'生产：修复',en:'REPAIR',icon:'Ⅴ',hint:'异星入侵：修复受损世界',color:'#72d7c4'},
  {id:11,name:'探索 Orb',en:'EXPLORE ORB',icon:'◈',hint:'探索异星遗迹',color:'#79afec'},
  {id:12,name:'边境加成',en:'FRONTIER',icon:'Ⅲ',hint:'先选殖民，再循环选择左侧加成、右侧加成、取消',color:'#c7df92'}
];
export const EXPANSIONS = [
  {id:0,name:'基础游戏',en:'Base Game',max:4,modes:[0]},
  {id:1,name:'风云际会',en:'The Gathering Storm',max:5,modes:[0]},
  {id:2,name:'反叛与帝国',en:'Rebel vs Imperium',max:6,modes:[0]},
  {id:3,name:'战争边缘',en:'The Brink of War',max:6,modes:[0]},
  {id:4,name:'异星遗迹',en:'Alien Artifacts',max:5,modes:[0,2]},
  {id:5,name:'异星入侵',en:'Xeno Invasion',max:5,modes:[0,1]},
  {id:6,name:'反叛与帝国（独立）',en:'Rebel vs Imperium only',max:5,modes:[0]},
  {id:7,name:'异星反击：边境',en:'Xeno Counterstrike',max:4,modes:[3]},
  {id:8,name:'异星反击',en:'Xeno Counterstrike',max:5,modes:[4,5,3,1,0]}
];
export const MODES = ['标准','入侵','Orb 遗迹','边境','反击','入侵 + 边境'];
export const GOODS = ['','任意','新奇','稀有','基因','异星'];
export const GOOD_COLORS = ['','#cccccc','#58aff9','#b58a54','#86c75f','#e5cf57'];
export const GOALS = ['最先获得 5 胜利点','最先拥有 4 类货物世界','最先拥有 3 张异星牌','最先回合末弃牌','最先覆盖全部阶段能力','最先建造 6 费发展','最先拥有 3 张提升牌','最先拥有 4 件货物','最先拥有 8 张场牌','最先达到负军力','最先获得 2 威望','最先拥有 4 个军事世界','最高军力','最多新奇/稀有世界','最多发展牌','最多生产世界','最多探索能力','最多反叛世界','最高威望','最多消费能力'];
