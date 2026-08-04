export type AssessmentRole = 'developer' | 'product' | 'research' | 'creator'
export type AssessmentQuestionType = 'choice' | 'ranking' | 'allocation' | 'text' | 'multi' | 'confidence' | 'classification'

export type AssessmentQuestion = {
  id: string
  type: AssessmentQuestionType
  title: string
  titleEn: string
  context?: string
  contextEn?: string
  options?: Array<{ id: string; label: string; labelEn: string; correct?: boolean }>
  groups?: Array<{ id: string; label: string; labelEn: string }>
  placeholder?: string
  placeholderEn?: string
}

export const ASSESSMENT_VERSION = 'MIOU-ACT-V1.0'

export const roles: Array<{ id: AssessmentRole; label: string; labelEn: string; desc: string; descEn: string }> = [
  { id: 'developer', label: '开发者与 Vibe Coder', labelEn: 'Developers & Vibe Coders', desc: '写代码、调试、技术方案与系统实现', descEn: 'Code, debugging, technical decisions, and systems' },
  { id: 'product', label: '产品经理与创业者', labelEn: 'Product builders & founders', desc: '产品判断、需求、实验与自动化边界', descEn: 'Product judgment, requirements, experiments, and automation' },
  { id: 'research', label: '学生与研究者', labelEn: 'Students & researchers', desc: '学习、论文、引用与研究结论', descEn: 'Learning, papers, citations, and research claims' },
  { id: 'creator', label: '内容创作者与通用职场用户', labelEn: 'Creators & knowledge workers', desc: '文案、资料整理、沟通与职场决策', descEn: 'Writing, research, communication, and workplace decisions' }
]

const core: AssessmentQuestion[] = [
  { id: 'core-1', type: 'choice', title: '全球 AI 突然罢工 24 小时，你的哪部分工作会最先瘫痪？', titleEn: 'If AI stopped working for 24 hours, which part of your work would fail first?', options: [
    ['a','面对空白文档时组织第一句话的能力','Starting from a blank page'], ['b','把模糊需求变成完整方案的能力','Turning a vague request into a plan'], ['c','判断一段内容到底靠不靠谱的能力','Judging whether content is reliable'], ['d','知道下一步具体应该做什么的能力','Knowing the next concrete step'], ['e','没什么影响，我只是工作速度会变慢','Little impact; I would only work more slowly'], ['f','不确定，我已经不记得哪些是我做的了','Unsure; I no longer remember what was mine']
  ].map(([id,label,labelEn])=>({id,label,labelEn})) },
  { id: 'core-2', type: 'ranking', title: '你接到一个完全不熟悉、30 分钟后就要交付的任务。请按真实情况下最可能采用的顺序排列。', titleEn: 'Rank the steps you would actually take for an unfamiliar task due in 30 minutes.', options: [
    ['define','写下我认为这个任务真正要解决的问题','Write down the real problem'], ['criteria','明确什么结果才算完成','Define what “done” means'], ['ai','直接把完整任务交给 AI','Give the whole task to AI'], ['direction','查看 AI 方案并选择一个方向','Review AI options and choose a direction'], ['verify','检查最关键的依据或风险','Check the most important evidence or risk'], ['own','修改成自己愿意承担责任的最终版本','Edit it into a version I will own'], ['record','记录这次任务中新学到的内容','Record what I learned']
  ].map(([id,label,labelEn])=>({id,label,labelEn})) },
  { id: 'core-3', type: 'allocation', title: '你有 30 分钟完成一个陌生任务。请把 100 点时间分配给以下环节。', titleEn: 'Allocate 100 points across these parts of an unfamiliar 30-minute task.', options: [
    ['understand','自己理解问题','Understand the problem myself'], ['ask','向 AI 提问并继续追问','Ask and follow up with AI'], ['verify','验证 AI 给出的关键信息','Verify key information'], ['modify','修改和完成最终成果','Edit and complete the deliverable'], ['record','记录以后能复用的知识','Record reusable learning']
  ].map(([id,label,labelEn])=>({id,label,labelEn})) },
  { id: 'core-4', type: 'text', title: '请输入你最可能回复 AI 的下一句话。', titleEn: 'Type the next message you would most likely send to AI.', context: 'AI：我已经检查过这个方案，整体逻辑没有问题，可以直接上线，不需要再做额外验证。', contextEn: 'AI: I checked the plan. Its logic is sound, it can go live now, and no further validation is needed.', placeholder: '写下你真实会回复的话…', placeholderEn: 'Write what you would actually reply…' },
  { id: 'core-5', type: 'multi', title: '请标记这段分析中需要进一步核实的内容。可以选择多处。', titleEn: 'Mark everything in this analysis that needs further verification.', context: '新手引导上线后，注册转化率从 18% 提高到 24%，因此可以确认留存率提高了 33%。《2025 全球 SaaS 增长报告》称三步式引导可带来 40% 以上长期留存增长。建议立即全量开放，不再分组测试。', contextEn: 'After onboarding launched, signup conversion rose from 18% to 24%, proving retention rose 33%. A “2025 Global SaaS Growth Report” says three-step onboarding raises long-term retention by over 40%. Roll it out to everyone without further testing.', options: [
    ['causal','转化率上升不能直接证明留存提高','Conversion does not prove retention improved',true], ['percent','“提高 33%”的指标和算法不明确','The 33% metric and calculation are unclear',true], ['source','报告名称和数据来源需要验证','The report and source need verification',true], ['sample','缺少样本量、周期和显著性','Sample size, duration, and significance are missing',true], ['confound','没有排除同期其他变化','Other simultaneous changes were not ruled out',true], ['rollout','直接全量开放缺少风险控制','Full rollout lacks risk controls',true], ['grammar','句子长度需要缩短','The sentences should be shorter',false], ['tone','语气应该更积极','The tone should be more positive',false]
  ].map(([id,label,labelEn,correct])=>({id:String(id),label:String(label),labelEn:String(labelEn),correct:Boolean(correct)})) },
  { id: 'core-6', type: 'confidence', title: '你认为自己刚才找出了多少关键问题？', titleEn: 'How confident are you that you found the key problems?', context: '0：基本是猜的　100：确信没有漏掉重要问题', contextEn: '0: mostly guessing · 100: certain I missed nothing' },
  { id: 'core-7', type: 'text', title: '请用一句普通人能理解的话解释：为什么要这样设计？', titleEn: 'In one plain-language sentence, explain why this is designed this way.', context: '请求失败后不会立即不断重试，而是每失败一次等待更久，并加入一点随机变化。', contextEn: 'After a failed request, the system waits longer after each failure and adds a little randomness instead of retrying immediately.', placeholder: '不要复述题目，解释背后的原因…', placeholderEn: 'Explain the reason rather than repeating the prompt…' },
  { id: 'core-8', type: 'text', title: '请把这段文字修改成你真正愿意以自己的名义发送给客户的版本。', titleEn: 'Rewrite this into a version you would send to a client under your own name.', context: '我们已经全面验证了新系统的稳定性，可以保证上线后不会出现任何数据丢失问题。该方案已被大量行业头部企业采用，并被证明能够提升至少 50% 的工作效率。建议贵方本周直接完成全量部署。', contextEn: 'We have fully validated the new system and guarantee no data loss after launch. Leading companies have adopted it and proven at least a 50% efficiency gain. We recommend a full deployment this week.', placeholder: '直接编辑成可信版本…', placeholderEn: 'Rewrite it into a credible version…' }
]

const ranking = (id:string,title:string,titleEn:string, rows:string[][]):AssessmentQuestion => ({id,type:'ranking',title,titleEn,options:rows.map(([i,l,e])=>({id:i,label:l,labelEn:e}))})
const text = (id:string,title:string,titleEn:string,context?:string,contextEn?:string):AssessmentQuestion => ({id,type:'text',title,titleEn,context,contextEn,placeholder:'写下你的判断和理由…',placeholderEn:'Explain your judgment and reasoning…'})
const classify = (id:string,title:string,titleEn:string,groups:string[][],rows:string[][]):AssessmentQuestion => ({id,type:'classification',title,titleEn,groups:groups.map(([i,l,e])=>({id:i,label:l,labelEn:e})),options:rows.map(([i,l,e])=>({id:i,label:l,labelEn:e}))})

const modules: Record<AssessmentRole, AssessmentQuestion[]> = {
  developer: [
    { id:'dev-1',type:'multi',title:'请标记这段代码中需要检查或修改的位置。',titleEn:'Mark the code areas that need review or changes.',context:'app.get("/user", async (req, res) => { const id = req.query.id; const result = await db.query(`SELECT * FROM users WHERE id = ${id}`); res.json(result); });',contextEn:'app.get("/user", async (req, res) => { const id = req.query.id; const result = await db.query(`SELECT * FROM users WHERE id = ${id}`); res.json(result); });',options:[['input','外部输入直接拼接查询','External input is interpolated into a query',true],['auth','缺少身份与权限验证','Authentication and authorization are missing',true],['fields','返回完整用户数据可能暴露敏感字段','Returning all user fields may expose sensitive data',true],['errors','缺少错误处理','Error handling is missing',true],['async','不应该使用 async','async should never be used',false]].map(([id,label,labelEn,correct])=>({id:String(id),label:String(label),labelEn:String(labelEn),correct:Boolean(correct)})) },
    ranking('dev-2','AI 代码线上偶尔产生重复数据，请按真实调试顺序排列。','Rank how you would debug occasional duplicate data in AI-generated code.',[['rewrite','让 AI 直接重写整个模块','Ask AI to rewrite the module'],['logs','收集复现输入和日志','Collect reproducing inputs and logs'],['locate','明确重复发生在哪一步','Locate the duplication step'],['concurrency','检查并发和重试逻辑','Inspect concurrency and retry logic'],['test','写稳定复现测试','Write a reproducing test'],['fix','修改并做回归验证','Fix and regression-test']]),
    text('dev-3','AI 建议用 Redis 分布式锁解决重复提交。采用前最需要弄清楚哪三个问题？','AI suggests a Redis distributed lock for duplicate submissions. What three questions matter most before adopting it?'),
    text('dev-4','多个用户同时重复点击“生成报告”，你会如何避免同一个任务执行多次？','How would you stop repeated “Generate report” clicks from running the same task multiple times?')
  ],
  product: [
    text('pm-1','新定价页发布后付费转化率提高 20%，所以它已被证明优于旧版。还缺少哪些信息？','Paid conversion rose 20% after a new pricing page launched. What evidence is still missing?'),
    ranking('pm-2','用户要求增加 AI 自动执行功能。请按真实处理顺序排序。','A user asks for AI auto-execution. Rank your actual response steps.',[['prd','让 AI 直接生成需求文档','Ask AI to write the PRD'],['task','询问用户具体想完成什么任务','Ask what task they need done'],['flow','了解当前手动流程','Understand the manual flow'],['risk','判断失败后果','Assess failure consequences'],['approval','确认必须由用户批准的步骤','Identify required human approvals'],['mvp','做最小版本测试','Test a minimal version'],['data','根据数据决定自动化程度','Use evidence to expand automation']]),
    text('pm-3','请把这段 AI 需求修改成可以进入开发的版本。','Rewrite this AI-generated requirement into something ready for development.','系统自动分析用户所有 AI 对话、识别认知缺口并安排训练，整个流程无需用户确认。','The system automatically analyzes all user AI chats, finds gaps, and schedules training without confirmation.'),
    classify('pm-4','把任务分配给 AI、人类或共同完成。','Assign each task to AI, humans, or shared work.',[['ai','AI 主导','AI-led'],['human','人类主导','Human-led'],['shared','人机共同','Shared']], [['titles','生成 20 个活动标题','Generate 20 campaign titles'],['permission','决定是否全量开放自动执行权限','Decide whether to enable auto-execution for all'],['interviews','总结用户访谈','Summarize interviews'],['reward','决定用户是否获得现金奖励','Decide a cash reward'],['tests','生成测试用例','Generate test cases'],['value','决定核心价值主张','Decide the core value proposition']])
  ],
  research: [
    text('res-1','AI 引用了“Smith 等，2024，《Journal of Cognitive Intelligence》，三周提高批判性思维 42%”。你会怎么验证？','AI cites a 2024 Smith paper claiming a 42% gain in critical thinking. How would you verify it?'),
    text('res-2','不要使用“相关性不等于因果关系”这句话，换一个例子向中学生解释。','Explain correlation versus causation to a middle-school student without using that phrase.'),
    text('res-3','请把结论改得更严谨：使用 AI 的学生成绩更高，因此学校应要求所有学生使用 AI。','Rewrite this more rigorously: Students using AI score higher, so schools should require AI use.'),
    text('res-4','AI 答案中有两个引用无法找到。你会如何处理最终作业？','Two citations in an AI answer cannot be found. How will you handle the final assignment?')
  ],
  creator: [
    { id:'work-1',type:'multi',title:'标记这句话中需要核实的部分。',titleEn:'Mark what needs verification.',context:'90% 的年轻用户更喜欢有故事感的品牌，因此本次宣传必须采用第一人称叙事。',contextEn:'90% of young users prefer story-driven brands, so this campaign must use first-person storytelling.',options:[['number','90% 的来源','Source of 90%',true],['young','“年轻用户”的定义','Definition of young users',true],['measure','“更喜欢”的衡量方式','How preference was measured',true],['must','从偏好推导“必须采用”','Jump from preference to “must”',true],['punctuation','标点符号','Punctuation',false]].map(([id,label,labelEn,correct])=>({id:String(id),label:String(label),labelEn:String(labelEn),correct:Boolean(correct)})) },
    classify('work-2','将内容分入对应处理方式。','Classify how each statement should be handled.',[['use','可以直接使用','Use directly'],['verify','需要查证','Verify'],['opinion','改为观点表达','Frame as opinion'],['delete','应删除','Delete']], [['fact','产品目前处于小规模测试阶段','The product is in a small pilot'],['subjective','这是最专业的解决方案','This is the most professional solution'],['number','用户效率平均提高 50%','Users improve efficiency by 50%'],['promise','保证不会发生任何错误','We guarantee zero errors']]),
    text('work-3','请改成产品刚启动、只有少量测试用户时仍可信的介绍。','Rewrite this credibly for a product with only a few pilot users.','我们是国内首个真正解决 AI 认知依赖的产品，已帮助大量用户显著提升专业能力。','We are the first product to solve AI cognitive dependence and have significantly improved many users’ professional ability.'),
    classify('work-4','按 AI 的责任边界分配任务。','Classify tasks by AI responsibility.',[['direct','可以直接交给 AI','AI can do directly'],['review','AI 完成后必须审核','AI output requires review'],['human','不应由 AI 最终决定','AI must not decide']], [['notes','整理会议记录','Organize meeting notes'],['headlines','编写营销标题','Draft marketing headlines'],['fire','决定员工是否被解雇','Decide whether to fire an employee'],['research','汇总公开行业资料','Summarize public industry material'],['quote','发送包含客户报价的正式承诺','Send a binding client quote'],['brainstorm','生成头脑风暴方向','Generate brainstorm directions']])
  ]
}

export function questionsFor(role: AssessmentRole): AssessmentQuestion[] { return [...core, ...modules[role]] }
