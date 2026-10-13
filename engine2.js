/* ============================================================
   engine2.js —— 纯模板「高差异化」引擎（不调用任何大模型）
   核心思路：把随机粒度从「整句」下沉到「词/短语槽位」
   ============================================================
   四个机制：
   1. 骨架 × 槽位：一句话由 1 个骨架 + 2~4 个槽位组合而成
   2. 词面变异：称呼/程度副词/量词/语气词独立随机
   3. 结构洗牌：段内顺序 + 句数随机
   4. 相似度闸门：生成后自检与历史的 n-gram 重合率，超标重抽
   ============================================================ */
(function(root){

/* ---------- 通用骨架工具 ---------- */
function fill(tpl, slots){
  return tpl.replace(/\{(\w+)\}/g, function(_, k){
    var arr = slots[k];
    return arr[Math.floor(Math.random() * arr.length)];
  });
}

/* ---------- 1. 维度语料库：骨架 + 槽位 ---------- */
var BANK = {
  '性价比高': { w:1, frames:[
    { t:'{cmp}{obj}，这家{judge}', s:{
      cmp:['对比了','看了','比过','比较了'],
      obj:['周边好几家酒店','附近几家同价位的','相隔不远的几家','网上好几家'],
      judge:['性价比是最高的','还是最划算','最值','算下来最合适','价格最实在'] } },
    { t:'{price}能有这样的{cond}，{feel}', s:{
      price:['这个价位','这个价格','这个价钱','就这个钱'],
      cond:['房间','条件','设施','环境'],
      feel:['真挑不出什么','已经超出我预期了','实在没什么好说的','算是很可以了','没什么失望的'] } },
    { t:'{spend}，{res}', s:{
      spend:['花的钱不多','价格不算贵','没花多少钱','预算不高'],
      res:['住得却很舒服','体验一点没缩水','该有的都有','品质一点没打折','没怎么将就'] } },
    { t:'同价位里这家{adv}', s:{
      adv:['算是很能打的','挺难得的','不太容易找到对手','算是很良心','挺能打'] } }
  ]},

  '卫生干净': { w:3, frames:[
    { t:'{act}{loc}，{res}', s:{
      act:['特意看了看','随手摸了摸','仔细瞧了瞧','顺手翻了下','认真看了下'],
      loc:['桌面和地面','床头柜和卫生间','窗台和边边角角','床单和被套','台面和地板'],
      res:['都没什么灰','干净得很','挑不出毛病','一点不糊弄','擦得很到位'] } },
    { t:'{part}{state}', s:{
      part:['床单被套','卫生间','毛巾浴巾','地面和台面','水杯和茶具'],
      state:['干净清爽，一点异味都没有','干净得让人放心','明显是换过的','打理得很到位','清清爽爽的'] } },
    { t:'卫生这块{judge}', s:{
      judge:['看得出是用了心的','完全不用操心','做得很扎实','没什么可挑剔的','很让人放心'] } },
    { t:'进门{feel}', s:{
      feel:['第一感觉就是干净','就觉得挺清爽','没什么说不清的味道','印象分一下上来了','看着就舒服'] } }
  ]},

  '服务热情': { w:4, frames:[
    { t:'{who}{att}，{act}', s:{
      who:['前台小姐姐','前台小哥','接待的姑娘','办理入住的小伙','工作人员','前台的员工','值班的小姑娘'],
      att:['态度特别好','挺热情的','一直笑着','很亲切','说话很客气','特别有耐心','一点不敷衍'],
      act:['办入住几分钟就好了','手续办得很快','还主动介绍了周边的吃食','有问必答','退房也办得很利索','主动问我要不要延迟退房'] } },
    { t:'{when}，{detail}', s:{
      when:['办入住的时候','有事情要问的时候','问路的时候','退房的时候','出门前'],
      detail:['问什么都答得清楚，不用反复追问','有需要招呼一声马上就有人来','说话客气，也不催不赶','该交代的都主动交代了','需要帮忙的时候没有推脱'] } },
    { t:'服务{judge}', s:{
      judge:['让人觉得挺舒服的','不过分热情也不冷淡，刚刚好','是那种很自然的周到','没有公事公办的感觉','分寸感很好'] } },
    { t:'{who}{very}{traits}，{feel}', s:{
      who:['前台小姐姐','前台小哥','接待的姑娘','值班的小伙','工作人员'],
      very:['特别','很','格外','是真的','相当'],
      traits:['耐心','细心','热情','认真','周到'],
      feel:['加分不少','让人印象深刻','一进门心情就好','挺暖的','记住了这家'] } }
  ]},

  '床品舒服': { w:3, frames:[
    { t:'床垫{hard}，{res}', s:{
      hard:['软硬刚好','软硬适中','不软不硬','弹性刚好','偏硬一点正合适'],
      res:['一觉睡到天亮','躺下就不想起来','睡得特别沉','很快就能入睡','睡得特别香'] } },
    { t:'被子{state}，{feel}', s:{
      state:['很蓬松','带着太阳晒过的味道','厚薄刚好','轻软舒服','一盖就暖'],
      feel:['盖着特别踏实','很安心','整晚都很舒服','特别适合我','睡得很放松'] } },
    { t:'{item}{judge}', s:{
      item:['枕头','床品','这套床褥','被子和枕头的搭配'],
      judge:['高度刚好，脖子不酸','质量看得出来不便宜','很干净也很新','软硬对我很合适','枕着一点不塌'] } },
    { t:'这一觉{res}', s:{
      res:['是这几天睡得最好的一晚','睡得很值','比在家里还舒服','睡醒一点也不累','睡得特别沉'] } }
  ]},

  '安静舒适': { w:3, frames:[
    { t:'{iso}，{res}', s:{
      iso:['隔音比想象中好','窗户是双层的','周围没什么动静','房间位置不靠马路','走廊声音传不进来'],
      res:['晚上一点不吵','睡得挺安稳','几乎听不到外面声音','一觉没被吵醒','睡得特别静'] } },
    { t:'{env}，{feel}', s:{
      env:['走廊也很安静','整体氛围很清净','房间里外都挺静','没什么杂音','动静很小'],
      feel:['住着很放松','很适合休息','心一下就静下来','特别解压','睡得特别安稳'] } },
    { t:'{detail}，{feel}', s:{
      detail:['灯光是暖色的','空调声音很小','窗帘遮光做得好','房间的安静程度'],
      feel:['住着很舒坦','让人挺放松','睡意很快就上来了','配合得刚好','休息质量很高'] } }
  ]},

  '设施齐全': { w:2, frames:[
    { t:'{fac}都{state}', s:{
      fac:['该有的设施','房间里的配置','电器和日用品','基本配套','常用物件'],
      state:['配得很齐','一点不缺','挺齐全的','很完整','想得到的都有'] } },
    { t:'{item}{judge}', s:{
      item:['空调','热水壶','吹风机和拖鞋','插座和 USB 口','卫生间里的备品'],
      judge:['都正常工作，反应很快','看得出来维护得不错','位置安排得很顺手','不用自己额外带','摆放得很合理'] } },
    { t:'{extra}，{feel}', s:{
      extra:['还准备了免费茶水','有小冰箱可以用','备了雨伞','送了瓶装水','房间里有小茶台'],
      feel:['考虑得挺周到','挺意外的','很实用','细节做得不错','挺惊喜'] } }
  ]},

  '交通便利': { w:5, frames:[
    { t:'{loc}，{res}', s:{
      loc:['位置挺好找的','导航一下就能到门口','在主干道边上','离商圈不远','不偏僻'],
      res:['打车直接停门口','不用绕来绕去','出门就能叫到车','省了不少事','不折腾'] } },
    { t:'{way}过去{judge}', s:{
      way:['坐公交','打车','坐地铁','自驾','骑共享单车'],
      judge:['都很方便','几分钟就能到','不用走太远','挺省时间','不折腾'] } },
    { t:'{near}就在附近，{feel}', s:{
      near:['地铁站','商圈','美食街','便利店','公交站'],
      feel:['走过去也就几分钟','办事逛街都方便','省了不少时间','顺路就能去','不耽误事'] } }
  ]},

  '早餐好吃': { w:5, frames:[
    { t:'早餐{judge}，{feel}', s:{
      judge:['种类比我想的多','是加分项','热气腾腾的','中西式都有','比我预期的丰富'],
      feel:['吃饱正好出门','吃得很满足','吃完很有精神','比外面买的强','吃得很舒服'] } },
    { t:'{item}{state}', s:{
      item:['小菜和面点','粥和包子','现做的煎蛋','水果和酸奶','汤和主食'],
      state:['都是新鲜的','味道挺正','一直有得续','看着就干净','补得也及时'] } },
    { t:'{detail}', s:{
      detail:['用餐环境也挺干净','上餐速度不慢','餐厅座位够坐','阿姨会主动添菜','收拾得很及时'] } }
  ]},

  '热水充足': { w:4, frames:[
    { t:'热水{act}，{feel}', s:{
      act:['来得特别快','一开就是热的','水压很足','温度很稳定','不用等太久'],
      feel:['冲个澡很解乏','洗澡特别舒服','不用担心忽冷忽热','泡一下就放松了','洗完一身轻松'] } },
    { t:'{when}想洗澡，{res}', s:{
      when:['晚上回来','早上起来','半夜到店','跑了一天','吃完饭'],
      res:['随时都有热水','一点没等着','水温马上就上来了','洗得很痛快','不用排队等'] } },
    { t:'{qty}热水都稳', s:{
      qty:['24 小时','全天','什么时候用','从头到尾'] } }
  ]},

  '停车方便': { w:5, frames:[
    { t:'{way}，{feel}', s:{
      way:['楼下就有停车位','自带停车场','门口就能停','车位比较好找','院子里面就能停'],
      feel:['自驾省心不少','不用绕圈找位','挺实在的','很省事','方便得很'] } },
    { t:'{state}', s:{
      state:['车位不算紧张','晚上回来还有空位','停一晚上没被催','进出都挺顺','不用抢位'] } },
    { t:'{fee}这点{judge}', s:{
      fee:['停车不额外收费','停车是免费的','停一晚不用花钱'],
      judge:['挺实在','很加分','让人舒服','挺厚道'] } }
  ]},

  'WiFi快': { w:5, frames:[
    { t:'网速{act}，{use}', s:{
      act:['挺快的','很稳定','信号满格','没掉过线','一直很给力'],
      use:['刷视频一点不卡','处理工作没问题','看剧不转圈','开视频会也顺','传文件很快'] } },
    { t:'{when}都{res}', s:{
      when:['连了两台设备','晚上高峰期','在房间各个位置','连着开了一小时会','躺在床上'],
      res:['都很稳','没什么影响','速度照样可以','一次没断','信号都是满的'] } },
    { t:'WiFi 这块{judge}', s:{
      judge:['不用操心','超出我预期','做得挺到位','很省心','挺给力'] } }
  ]},

  '周边好玩': { w:5, frames:[
    { t:'{near}{dist}，{feel}', s:{
      near:['晚上出门逛街','楼下就有小吃','附近有个商场','周边吃的挺多','走两步就有夜市'],
      dist:['走几步就到了','步行范围内','不用打车','都很近','拐个弯就到'],
      feel:['逛吃逛吃很方便','生活气息很足','夜生活不用愁','玩得挺开心','晚上也不无聊'] } },
    { t:'{conf}{judge}', s:{
      conf:['附近餐饮和便利店','周边小店','商圈和夜市','吃的玩的'],
      judge:['都挺全的','不用走远','选择很多','挺热闹','应有尽有'] } },
    { t:'{act}很省事', s:{
      act:['出来找吃的','晚上散步','逛街买东西','约朋友碰面','带孩子溜达'] } }
  ]}
};

/* ---------- 2. 开场：只写不涉及事实的引入 ----------
   原则：同行人／出行目的／到店时间属于「事实」，只能来自用户输入。
   用户没说就绝不编 —— 编出来的场景顾客粘贴出去就是虚假陈述。 */
var NEUTRAL_OPENERS = [
  '这次住的这家，说下实际感受。',
  '简单说下这次的入住体验。',
  '订之前看了不少评价，自己也写一条。',
  '住完留个真实评价。',
  '说说这次住下来的感受。',
  '选之前对比了几家，说下实际体验。',
  '挑了一阵子订的这家，说下真实感受。',
  '订房前翻了挺多评价，自己也补一条。'
];

/* 只有用户真的提供了，才把它写进开场句。
   填了就大概率用上（85%），否则用户会觉得「我填了它没用」。 */
function buildOpener(facts){
  facts = facts || {};
  var books = ['订了这家','选了这家','住的就是这家','挑的这家','最后敲定了这家'];
  var fact = [];

  if(facts.purpose && facts.company){
    fact.push(facts.purpose + '的时候' + facts.company + '，' + pick(books) + '。');
  } else if(facts.purpose){
    fact.push('这次' + facts.purpose + '，' + pick(books) + '。');
  } else if(facts.company){
    fact.push('这次' + facts.company + '，' + pick(books) + '。');
  }
  if(facts.arrival){
    fact.push(facts.arrival + '，' +
      pick(['房间已经收拾好了','前台还在忙','办手续挺快','房间直接就能进','店员还在等着']) + '。');
  }

  if(fact.length && Math.random() < 0.85) return pick(fact);
  return pick(NEUTRAL_OPENERS);
}

/* ---------- 3. 感受句 / 4. 收尾句 / 5. 连接词 ---------- */
var FEELINGS = ['整体住下来挺满意的。','住得比预期要好。','这一晚住得挺舒服。','总体感觉不错。',
  '体验下来没什么可挑的。','算是一次挺愉快的入住。','住得挺踏实。','比我预想的要顺。','挺满意的。',
  '住着很自在。','这一趟住得值。','没什么让人不舒服的地方。','整体超出我的预期。','住得挺顺心的。',
  '这次选择没做错。','住下来感觉挺不错。','各方面都挺合我心意。','总的来说住得挺满意。'];

var CLOSERS = ['给后来入住的人一个真实参考。','下次来这边还会再选这家。','也推荐给有需要的朋友。',
  '之后有需要还会再来。','写下来给后面的朋友参考一下。','总的来说值得推荐。','以后过来还住这儿。',
  '希望这个评价对别人有用。','有机会还会回来住。','感觉挺值的，推荐一下。','分享给同样要找酒店的朋友。',
  '下次还会优先考虑这里。','需要的话可以放心选。','给准备订房的人做个参考。','整体值得这个价。',
  '有需要的话还会订这家。','算是一次很满意的入住。','推荐给路过的朋友。'];

var LINKERS = ['另外，','还有，','再就是，','而且，','对了，','顺便说一句，','除此之外，','要说起来，'];

/* ---------- 6. 语义重复黑名单（避免同一段话出现两个相似词） ---------- */
var DUP_GUARD = [
  ['性价比','价位','价格','价钱','划算','便宜','花得值','不贵'],
  ['干净','卫生','清爽','打扫','收拾'],
  ['热情','态度','服务','亲切','周到'],
  ['安静','隔音','清净','不吵','静'],
  ['方便','便利','省事','省心','顺'],
  ['好吃','味道','早餐','口感'],
  ['快','稳定','顺','不卡']
];

/* ---------- 7. 生成核心 ---------- */
function pick(a){ return a[Math.floor(Math.random() * a.length)]; }

function buildSentence(tagKey){
  var item = BANK[tagKey];
  if(!item) return '';
  var f = pick(item.frames);
  return fill(f.t, f.s);
}

/* 关键词重合度：粗判两句是否在说同一件事 */
function keywordOverlap(a, b){
  for(var g = 0; g < DUP_GUARD.length; g++){
    var grp = DUP_GUARD[g];
    var ha = grp.some(function(w){ return a.indexOf(w) > -1; });
    var hb = grp.some(function(w){ return b.indexOf(w) > -1; });
    if(ha && hb) return true;
  }
  return false;
}

/**
 * 生成一条文案
 * @param {string[]} tagKeys  用户勾选的维度
 * @param {object}   opt      { history:[], maxSim:0.30, tries:12 }
 */
function generate(tagKeys, opt){
  opt = opt || {};
  var history = opt.history || [];
  var facts = opt.facts || {};
  var maxSim = opt.maxSim == null ? 0.30 : opt.maxSim;
  var tries = opt.tries || 12;

  var best = null, bestScore = 2;

  for(var attempt = 0; attempt < tries; attempt++){
    var text = compose(tagKeys, facts);
    if(!history.length){ return text; }
    var worst = 0;
    for(var h = 0; h < history.length; h++){
      var s = dice4(text, history[h]);
      if(s > worst) worst = s;
    }
    if(worst < bestScore){ bestScore = worst; best = text; }
    if(worst <= maxSim) return text;   /* 达标即返回 */
  }
  return best;   /* 兜底：返回合格度最高的那条 */
}

function compose(tagKeys, facts){
  /* 维度按权重排序：总评/位置 → 硬件 → 服务 */
  var chosen = (tagKeys || [])
    .filter(function(k){ return BANK[k]; })
    .sort(function(a, b){ return BANK[a].w - BANK[b].w; })
    .slice(0, 6);

  /* 段内洗牌：同权重区间内随机换序 */
  for(var i = chosen.length - 1; i > 0; i--){
    if(BANK[chosen[i]].w === BANK[chosen[i - 1]].w && Math.random() < 0.5){
      var tmp = chosen[i]; chosen[i] = chosen[i - 1]; chosen[i - 1] = tmp;
    }
  }

  var sents = [];
  var usedLinkers = [];
  for(var j = 0; j < chosen.length; j++){
    var s = buildSentence(chosen[j]);
    var guard = 0;
    /* 与已生成句子语义撞车 → 重抽（最多 6 次） */
    while(s && sents.some(function(x){ return keywordOverlap(x, s); }) && guard++ < 6){
      s = buildSentence(chosen[j]);
    }
    /* 随机加连接词：约 45% 概率，且全篇不重复同一个连接词 */
    if(s && j > 0 && Math.random() < 0.45){
      var avail = LINKERS.filter(function(l){ return usedLinkers.indexOf(l) === -1; });
      if(avail.length){
        var lk = pick(avail);
        usedLinkers.push(lk);
        s = lk + s;
      }
    }
    if(s) sents.push(s);
  }

  /* 句数随机：偶尔合并/精简，制造长度差异 */
  if(sents.length > 4 && Math.random() < 0.35) sents.splice(Math.floor(Math.random() * sents.length), 1);

  var text = buildOpener(facts);
  if(sents.length) text += sents.join('。') + '。';
  text += pick(FEELINGS);
  text += pick(CLOSERS);
  return text;
}

/* ---------- 8. 4-gram Dice 相似度（与测试口径一致） ---------- */
function dice4(a, b){
  var n = 4, A = {}, B = {}, ai = 0, bi = 0;
  for(var i = 0; i + n <= a.length; i++){ var g = a.substr(i, n); if(!A[g]){ A[g] = 1; ai++; } }
  for(var j = 0; j + n <= b.length; j++){ var h = b.substr(j, n); if(!B[h]){ B[h] = 1; bi++; } }
  if(!ai || !bi) return 0;
  var c = 0;
  for(var k in A){ if(B[k]) c++; }
  return 2 * c / (ai + bi);
}

var API = { generate:generate, compose:compose, dice4:dice4, BANK:BANK, buildOpener:buildOpener,
            NEUTRAL_OPENERS:NEUTRAL_OPENERS, FEELINGS:FEELINGS, CLOSERS:CLOSERS, LINKERS:LINKERS };

if(typeof module !== 'undefined' && module.exports) module.exports = API;
else root.Engine2 = API;

})(typeof window !== 'undefined' ? window : this);
