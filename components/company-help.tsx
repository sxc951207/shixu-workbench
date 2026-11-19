'use client';

import React, {useState} from 'react';
import {ArrowUpRight,BookOpen,Check,ChevronDown,ClipboardCheck,Database,FileSpreadsheet,HelpCircle,Layers3,Search,ShieldCheck,UsersRound} from 'lucide-react';
import '../app/company-help.css';
import {SectionMark} from './workspace-material';
import {firstSteps} from './company-welcome';

type GuideRole='reporter'|'supervisor'|'leader'|'admin';
type Guide={id:string;title:string;intro:string;roles:GuideRole[];icon:typeof BookOpen;steps:string[];note?:string;action?:{label:string;tab:string};keywords?:string};
type FAQ={question:string;answer:string;keywords?:string};
const roleNames:Record<GuideRole,string>={reporter:'填报人',supervisor:'确认主管',leader:'领导',admin:'管理员'};
const allRoles:GuideRole[]=['reporter','supervisor','leader','admin'];
const guides:Guide[]=[
 {id:'project-upload',title:'手里有原表，怎样开始填报？',intro:'在「数据报表」选经营项目，点「上传报表」。',roles:['reporter','supervisor','admin'],icon:FileSpreadsheet,steps:[
  '选择 Excel、粘贴截图或拖入文件。一个工作簿有几张表时，先核对所选工作表和表头。',
  '匹配清楚会打开对应表的预览。有两种可能时，按原表的业务含义选择。内容相同的金额可能来自不同平台，也可能分别表示当天和期间累计。',
  '首次出现的表可以建立新模板。员工提交指标方案后，等主管确认，再回到当前浏览器标签页，从「上传报表」继续填报已保留的原表。',
  '核对业务日期、门店和金额后保存草稿，再提交确认。'],keywords:'上传 截图 自动识别 匹配 自定义模板 原表 Excel',action:{label:'打开数据报表',tab:'operating'}},
 {id:'first-report',title:'第一次用，先走通一份样例',intro:'先认清项目、日期和确认人，再开始正式填报。',roles:allRoles,icon:BookOpen,steps:[
  '先打开只读演示或试用数据模板，熟悉界面；真实协作前，建议在测试公司用一个项目走通流程。',
  '管理员添加成员并分配项目负责人、确认主管和参与人。项目负责人或参与员工从“填报指标”进入设置，用现有表格或预设起草方案。',
  '主管确认指标后，填写人选一个业务日期，保存草稿，再提交主管核实。',
  '主管核对并确认后，再看领导视图和已确认汇总。确认结果正确，再开始连续使用。',
 ],note:'示例数字仅供试用。正式公司中的数据，要由填写人与确认人核对来源。',action:{label:'打开数据报表',tab:'operating'},keywords:'新手 入门 首次 引导 样本 开始'},
 {id:'templates',title:'按项目选择要汇报的内容',intro:'有现成 Excel 就用现成的，也可以从预设开始勾选指标。',roles:allRoles,icon:Layers3,steps:[
  '项目负责人或参与员工点“填报指标”，选自己的项目。电脑可拖入整份 Excel，手机点“选择表格”。',
  '逐张选要用的工作表，核对识别出的字段、单位、公式和门店，点“将此工作表加入指标方案”。也可手动选字段，再一起提交主管。',
  '主管在“待我确认”核对指标方案，可以补充后确认，也可以写明原因退回。确认后，项目负责人即可按这套结构填数。',
  '领导在已获授权公司的已确认项目中点“补充指标”。新增字段用于新记录，旧记录保留填报时的结构。',
 ],note:'复制只沿用结构，不复制旧数据或成员权限；填写人默认管理员或项目负责人，保存前须重新确认。已有模板、标准套表和历史继续保留。',action:{label:'去选项目模板',tab:'operating'},keywords:'自选 勾选 字段 配置 定义 来源 统计口径 元数据 结构 固定 预设 复制 修改 表单'},
 {id:'file-import',title:'把已有表格带进来',intro:'先选工作表和表头，再检查预览，最后应用。',roles:['reporter','supervisor','admin'],icon:FileSpreadsheet,steps:[
  '选择或拖入 .xlsx、.csv、.tsv、.txt 文件，单个文件最多 5 MiB。旧版 .xls 请先在表格软件中另存为 .xlsx。',
  '没有 Excel 时，可在同一入口点“用报表截图生成”，选一张保留表头、单位和门店名的清晰原图。对照原图改正识别错字，再加入指标方案。Excel 支持常见双层表头和横排门店。核对预览；若选错，可手动选工作表和表头行。',
  '总业绩原表若门店横排、日期竖排，选择对应源表方向，确认当前日期行是当日发生额；系统只取那一天，目标、完成率和汇总列不相加。门店名须精确对应。',
  '生成模板时，识别结果只是候选字段：逐个核对名称、类型、必填项和统计口径，再保存结构。源表数字不会因此直接保存为业务记录。',
  '向填报表导入数据时，先选当前日期或实际截止日，检查字段对应、分行名称、空值与金额单位；核对预览后再应用、保存并提交确认。',
 ],note:'多日导入后，回执按业务日期区分草稿、待确认和已确认。展开草稿可核对并勾选提交。只有累计数的原表，请按原表截止日保存累计快照。',action:{label:'打开数据报表',tab:'operating'},keywords:'上传 导入 拖拽 Excel CSV TSV TXT XLS XLSX 表头 文件 工作表 5MiB'},
 {id:'daily',title:'日录一次，再看累计与月报',intro:'先保存原始日事实，再按实际截止日汇总。',roles:allRoles,icon:Database,steps:[
  '日录填写当天发生的金额与数量；月目标单独按月份填写。月初累计、月报复用同一批日录，不用重复抄写。',
  '先核对报表日期。累计范围是当月 1 日到所选实际截止日；查整月时，要确认该月数据是否已齐。',
  '金额只按“元”输入；源表是分、万元等单位时，先换算并核对。未知的数据留空，只有确认实际为零才填 0。',
  '源表只有月累计或平台累计时，放到对应的累计明细，并注明实际截止日；不要抄到日录里。',
 ],note:'系统只汇总已有且符合当前范围的数据。空白、未填日期和未确认记录，不代表业务实际为零；比率缺值或分母为零时保留空白。',action:{label:'查看数据报表',tab:'operating'},keywords:'每天 原始 月初 月度 月报 周报 截止日期 累计 合计 真实 元 零 空白'},
 {id:'text-reports',title:'从员工日报整理项目周报、月报',intro:'在「项目汇报」选择汇报周期，主管确认后领导可按期查阅。',roles:allRoles,icon:ClipboardCheck,steps:[
  '打开员工日报，选工作日期与项目。可以手写，或勾选自己的待办、已办和每日必做。保存草稿后提交确认。',
  '编辑周报时点「从已确认日报生成建议稿」，月报则读取已确认周报。展开要点查看原文与确认版本，勾选后带入，也可继续手写。',
  '跨月周报供核对。只有本月范围内能明确归属的成果才写入月报。经营金额与涨跌仍在数据报表中核对。',
 ],note:'数值模板没有替代原来的项目进度与周月报。两类内容按各自的保存、提交和确认流程使用。',action:{label:'打开项目文字汇报',tab:'reports'},keywords:'文字 文本 周报 成果 风险 阻碍 下一步 备注'},
 {id:'review',title:'主管确认前，核对事实和来源',intro:'确认代表已经核实，不能只看数字是否填满。',roles:['supervisor','admin'],icon:ClipboardCheck,steps:[
  '在“待我确认”可直接打开等待最久的提交，或点经营更正核对改前、改后的数字。今日应交名单按已安排的日报统计。要找特定项目进度、经营数字或文字周月报，可按项目、类型和月份筛选。手机先点“筛选待审”。经营日表可在“数据报表 → 日录入”按月批量提交和确认。项目确认主管也可以确认自己提交的经营报表。项目进度和文字汇报仍由另一位确认人审核。',
  '核员工日报时，按姓名或登录名查找。读完一份可点“确认并看下一份”；需要补充时写明原因并退回。打开“按天看团队日报”可查看已确认、待核、退回，并给指定员工安排当天应交。',
  '找往期记录时，经营数字按业务月份，文字周月报按周期开始月，项目进度按提交月筛选。月份留空可跨期查找。点“继续查找待确认记录（含往期）”，直到显示“当前筛选范围已读取完整”。',
  '在“主管项目总览”按业务日期查看自己负责或担任确认主管的项目。点进项目可回看已确认的周月报、经营数字和同期对比。',
  '同批提交的经营日表会列出待核日期。点日期核对项目、来源、单位及金额，确认后这一天进入领导汇总。',
  '来源不清、缺项或口径不对时，填写具体意见并退回补充。填报人修改后重新提交。',
  '经营记录未确认前，提交人可撤回修改；确认后须先填写更正原因，再编辑、提交并重新确认。原来的已确认版本和历史继续保留。',
 ],note:'系统校验能检查格式与部分计算关系；事实是否真实、来源是否可靠，仍由填写人与确认人负责。',action:{label:'打开待我确认',tab:'review'},keywords:'审批 审核 审批人 退回 评论 意见 自审 非本人 真实性 来源'},
 {id:'leader',title:'领导看已确认版本',intro:'领导视图只展示权限范围内的确认结果。',roles:['leader','admin'],icon:ShieldCheck,steps:[
  '在“领导视图”的“会议查阅”按项目查历史经营数据或文字周月报。“各项目经营数据”默认显示昨天，可切上周、上月，或在“更多日期”中选其他业务日期。展开项目即可查看对应日期与门店。',
  '所选期没有已确认汇报时，可以从页面提示直接打开有汇报的日期。“历史回看”也可切上一周、上一月或回本期；经营数字的“上周截止”仍按当月1日累计到上周截止，并非上周7天合计。精确日期仍可在下方筛选。',
  '草稿、待确认或退回的更改，不会直接替换已确认快照。经营数据更正期间，显示上次已确认结果及“更正待确认”提示。',
  '在经营数据页的“对比范围”先选“上月同期”或“本周与上周同期”，再点“数字对比（已确认）”，查看上升或下降的金额、幅度和门店差异。上期为零只看差额，转化率变化看百分点。完整周或整月可展开已确认的项目变化原因。',
  '比较报表时，核对公司、项目、月份、实际截止日，以及确认时间和本次读取时间，再判断变化。',
  '开会查数时，在月初累计图形点日期看当天门店，点门店看逐日数值。用“返回图形”回到原指标和位置。趋势的覆盖天数按这个指标的有效确认值计算。',
 ],note:'有领导角色不代表能看所有公司、所有项目或所有原始数据。未出现的内容，先核对项目分配和访问权限。',action:{label:'打开领导视图',tab:'summary'},keywords:'老板 驾驶舱 快照 汇总 权限 可见 待确认 草稿'},
 {id:'backup',title:'管理员保存独立备份并验证',intro:'备份文件、完整性演练和恢复副本是不同操作。',roles:['admin'],icon:Database,steps:[
  '进入“数据保存”，查看最近尝试、最近成功备份和完整性演练状态；以页面显示的实际结果为准。',
  '点击“下载独立备份”，保存公司 v3 JSON。该格式包含项目、周月报、经营数据、相关配置与业务版本；密码、会话和邀请不会导出。',
  '运行“完整性演练”，等待全部记录核对完成。演练通过不代表刚刚生成了新的自动备份。',
  '恢复时先选择备份、上传校验并核对预览，再确认创建独立公司副本。原公司保留，导入成员全部停用，需重新配置身份与权限。',
 ],note:'独立导出不包含旧设置变更记录和定时检查点。备份成功时间以状态记录为准；不要只凭计划或页面说明判断已备份。',action:{label:'打开数据保存',tab:'data'},keywords:'备份 下载 JSON v3 恢复 还原 完整性 演练 停用 成员 独立副本 安全'},
];
const faqs:FAQ[]=[
 {question:'前几天忘了填，今天怎样一次补好？',answer:'进入对应平台的日录，点“填写本日数据”并展开“导入表格 / 识别截图”。导入含业务日期的逐日原表，在“按原表业务日期导入”选“全部业务日期”，读取预览，确认按原日期保存草稿。检查每一天的保存回执，再分别提交确认。同日已有记录时，先核对旧值和新值，再点“确认按差异更新草稿”。已确认记录需写更正原因并重新提交；只有一段期间的合计时，保存到累计明细。',keywords:'历史 多日 漏填 补录 批量 一次 多天'},
 {question:'领导怎样知道开会后有数字更正？',answer:'打开“领导视图”看“近期已生效更正”。每条标有项目、确认时间和新版本，展开可核对业务日期、原版本和变动的字段。回到标签页会刷新。仍在草稿或待审的修改，继续显示原确认数。',keywords:'消息 提醒 改错 更正 已生效 历史 版本'},
 {question:'开会能直接口头解释涨跌吗？',answer:'可以。项目周报或月报中的经营变化原因选填。完整周期的数字对比可以主动展开已确认说明。投屏默认收起原因，点“加入变化原因”才会加入原因页。',keywords:'上涨 下降 幅度 原因 口述 口头 选填 会议'},
 {question:'折线图和柱状图怎么选？',answer:'在“数据报表→月初累计”的经营图形中，先选择数据表和指标。系统按用途推荐：日期走势默认折线，门店或渠道比较默认柱状；日期走势也能手动切换柱状。图形只读取已确认版，更正中继续使用旧确认值。工作记录下方的草稿小计可能不同，选择“只看已确认”可统一口径。缺日留空，真实0保留，金额、数量、比率分别显示单位；自定义模板有多个字段时需自行选择指标。',keywords:'图形 折线 柱状 自动 推荐 单位 草稿 已确认'},
 {question:'本周与上周对比，会不会和经营周报累计混在一起？',answer:'不会。数字对比选择“本周与上周同期”时，从所选日期所在周的周一算到截止日，对比上周周一到相同星期；周日才是完整七天。它只合计逐日事实，不把手工月初累计快照当单周发生量。原经营周报仍是当月1日累计至截止日；两处均显示实际区间。',keywords:'周一 周日 上周 本周 同期 周报 月初累计'},
 {question:'领导能集中查看各项目同一天的数据吗？',answer:'可以。进入“领导视图”，“各项目经营数据”会自动显示昨天。点“更多日期”并选“自选日期”可回看指定业务日。所选业务日出现更正并重新通过后，再查同一天会看到新确认值。当前公司的授权项目按各自字段和单位展示。未配置、当天无已确认记录、空白与零会分别说明；月目标和手工累计快照不冒充单日数据。',keywords:'领导 当天 所有项目 日期 单日 总览'},

 {question:'项目要报哪些数据，由谁决定、谁来填？',answer:'项目负责人和参与员工都可以拖入现有工作簿或勾选字段，提交指标方案。指定主管核对后启用，也能补项或退回。领导可以给授权公司的已确认项目追加指标。员工提案生成的模板由项目负责人填报；门店经营套表的美团和抖音日录、门店累计由分配到该项目的员工填写；门店总业绩和月目标由项目指定主管填写。管理员负责授权和项目人员安排。',keywords:'主管 员工 管理员 配置员 模板 字段 填写人 项目负责人'},
 {question:'开会时看的文字周报或月报，可以保留当时那一版吗？',answer:'可以。在“项目汇报”找到该期文字报表，点“下载已确认版”，保存 HTML 文件。如员工填写了经营变化原因，可选择把它附进下载文件。下次开会直接打开这份文件，可复看下载时的内容。在线按业务日期查经营数字会显示最新确认值，之后通过的更正也会反映在内。',keywords:'会议 留底 历史 导出 下载 归档 HTML'},
 {question:'怎样少选几次项目、找到下一件要做的事？',answer:'员工在个人工作总览看到具体的待填记录时，点它即可进入对应项目、日期和表单。项目卡片也可直接打开该项目的数据报表、项目汇报和协作事项；从领导视图进入时沿用已确认范围。经营数据的“本项目待处理”列所选日期待填报及所选月份待本人确认，点进去按原流程核对。要集中处理多个项目或往期提交，可进入“待我确认”筛选并继续读取；未开放的项目会提示，不会替你打开另一个项目。',keywords:'快捷入口 待处理 待填报 待确认 项目 跳转'},
 {question:'原来的单独TSV读取入口去哪了？',answer:'已合并到统一导入区。TSV/TXT与Excel/CSV都从填写页导入区选择，直接粘贴仍保留；空白表可点“下载填报模板”。独立备份、完整性演练、历史及恢复入口继续保留。',keywords:'减少 简化 TSV 导入 备份 下载'},
 {question:'手机上日期或表头看不完整，怎么核对？',answer:'截图识别后可切“逐格核对”，选择行列，或点上一格/下一格，完整查看并修改当前内容。它与表格共用数据，不会另存一份；空白与0仍分开，任何修改都会要求重新勾选核对。浏览或切换格子不代表已核实全部数字。',keywords:'手机 窄屏 完整 单元格 逐格 长表头 日期'},
 {question:'截图的字段名和单位分成两行，怎么办？',answer:'先选字段名所在表头行，点“合并本行与下一行表头”。单位会保留；下一行像日期或数值数据时会拒绝合并。复杂分组仍需手工整理，检查后重新勾选核对。删行列会调整其余格子的原识别风险标记，不能因此跳过核对。',keywords:'OCR 表头 多行 合并 单位 删除'},
 {question:'总业绩表的门店都横着排，能导入吗？',answer:'可以。在「门店总业绩」导入截图或 Excel，系统会识别横排门店，并按原表日期列出可导入的每日金额。若同表还有月业绩指标，预览里会另列各门店当月目标，一张图即可核对两项。只录目标时，从「门店月目标」上传同图，只需核对上方的月份、店名和月目标。确认门店对应和金额后保存草稿。合计和完成率仅供核对。',keywords:'横排 横表 转置 方向 日期 总业绩'},
 {question:'报表截图怎么识别？会上传图片吗？',answer:'在项目模板库或数据填写的导入区，展开截图识别，选择PNG/JPG/WebP，点开始本机识别。图片不上传；首次需要下载识别字库。对照原图修改表头、错字、小数点、日期和空白格，选择表头行并勾选已核对，再进入原预览流程。模糊、合并表头或无清晰网格时需要手工整理，识别准确率没有保证。没有平台自动抓数。',keywords:'OCR 抓取 美团 抖音 截图 图片 本机 隐私'},
 {question:'不知道的数据可以先填 0 吗？',answer:'不可以。空白表示尚未提供，0 表示确认实际为零。必填项暂缺时，先保存草稿，核实后再提交。'},
 {question:'表格上传后，为什么还要确认字段？',answer:'识别结果只是候选内容。请核对定义、数据来源、统计口径和公式；金额只支持元，遇到其他单位提示时，先换算核对后再导入。文字说明仍写在项目汇报中。',keywords:'自动识别 名称 单位 公式 文本 分 万元'},
 {question:'模板停用后，发现历史数字填错了怎么办？',answer:'停用后不能新增记录，但已有记录仍可在原月份、原日期发起更正、补齐并重新提交；由当前有填写权限的人处理，再交另一人确认。停用的标准表和模板只要本月有历史，仍可查看。更正期间领导继续看上次确认值，历史字段结构不改写；换了填写人，以工作区显示的当前安排为准。',keywords:'停用 历史 更正 标准表 填写人 移交'},
 {question:'以前的模板想加一列，怎么做？',answer:'在“项目指标设置”可给已有自定义模板追加字段。新建记录采用新字段，老记录和已确认快照沿用当时的结构。改已有字段的单位、分行方式或公式时，复制为新模板并重新核对填写人。'},
 {question:'源表只有整月累计，可以自动补出每天的数据吗？',answer:'不能。累计无法还原每天真实发生额。请按对应的累计明细填报并核对截止日；有原始日数据后，再逐日录入或导入。',keywords:'历史 历史导入 拆分 每天'},
 {question:'已经修改了，领导怎么还看到旧数字？',answer:'领导读取已确认快照。更正待确认期间保留旧数字并显示提示；由另一位指定确认人核实后才更新。请同时核对记录状态、日期范围、确认时间与本次读取时间。'},
 {question:'经营数据提交后发现填错了，怎么改？',answer:'主管尚未确认时，由提交人撤回后修改并重新提交。已经确认的记录要发起更正，再由指定确认人核实；原确认结果和历史继续保留。',keywords:'撤回 撤销提交 修改'},
 {question:'找不到项目、模板或确认按钮怎么办？',answer:'先核对当前公司、项目和账号。填写人、确认人和领导的范围由角色与项目分配共同决定；请管理员检查成员是否启用及项目人员设置。'},
 {question:'关闭页面前没保存，还能找回经营填报吗？',answer:'填写时会尝试在本设备保留7天本机草稿，按账号、公司、项目、模板和日期区分。重新打开后可选恢复或丢弃；云端版本或字段结构已变化时，须人工核对合并。成功保存到云端后清除对应本机草稿。',keywords:'自动备份 恢复 丢弃 本地 本机 草稿 七天 7天'},
 {question:'文字周报和月报没保存就刷新了，怎么办？',answer:'重新打开同一份报表，有本机副本时会先提示恢复或舍弃。副本按账号、公司、项目及报表周期分开，尝试保留7天；云端版本已更新时，只能展开复制文字，再人工合并，不会直接覆盖。保存到云端成功，或明确放弃未保存修改后，清除对应副本。本机副本不跨设备同步，清理浏览器数据会移除，也不能保证系统突然关闭前的最后输入一定保住。',keywords:'文字 周报 月报 刷新 恢复 本机 草稿 七天 7天'},
 {question:'保存后遇到冲突或连接失败，怎么处理？',answer:'保留当前内容，查看提示并核对云端最新版本。不要把本机草稿当作云端保存成功：它不跨设备同步，也不会在离线后自动提交；版本冲突需人工合并后重新保存。',keywords:'报错 网络 重试 版本 离线 同步 自动提交'},
 {question:'这里和个人工作台、桌面挂件是什么关系？',answer:'公司版按角色协作。个人工作台首页的快速待办和随手记遇到断网，可在同一标签页刷新、联网后重试。看到保存成功才算提交；碰到其他设备修改会保留输入供核对。关闭标签页可能丢失未提交内容。桌面挂件显示个人事项。',keywords:'小组件 桌面 个人 同步'},
];

export default function CompanyHelp({roles,onNavigate}:{roles:string[];onNavigate:(tab:string)=>void}){
 const [query,setQuery]=useState(''),[filter,setFilter]=useState<'mine'|'all'|GuideRole>('mine');
 const admin=roles.includes('owner')||roles.includes('admin');
 const assigned:GuideRole[]=admin?allRoles:[...(roles.includes('employee')?['reporter' as const]:[]),...(roles.includes('supervisor')?['supervisor' as const]:[]),...(roles.includes('leader')?['leader' as const]:[])];
 const recommended=assigned.length?assigned:['reporter' as const];
 const tokens=query.trim().toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean);
 const matches=(value:string)=>tokens.every(token=>value.toLocaleLowerCase('zh-CN').includes(token));
 const visible=guides.filter(guide=>(filter==='all'||guide.roles.some(role=>(filter==='mine'?recommended:[filter]).includes(role)))&&matches([guide.title,guide.intro,...guide.steps,guide.note,guide.keywords].join(' ')));
 const visibleFaqs=faqs.filter(faq=>matches([faq.question,faq.answer,faq.keywords].join(' ')));
 const allowed=(tab:string)=>tab==='data'?admin:tab==='review'?admin||roles.includes('supervisor'):tab==='summary'?admin||roles.includes('leader'):true;
 return <div className="company-help">
  <header className="ch-heading"><SectionMark icon={HelpCircle}/><div><h1>使用帮助</h1><p>从一份样例开始，把填写、核对、确认和查看连起来。</p></div></header>
  <section className="ch-first-steps" aria-label="我的入门步骤"><h2>我的入门步骤</h2>{firstSteps(roles).map((guide,index)=><details key={guide.tab} open={index===0}><summary>{guide.title}</summary><ol>{guide.steps.map(step=><li key={step}>{step}</li>)}</ol><button className="co-primary" type="button" onClick={()=>onNavigate(guide.tab)}>{guide.button} <ArrowUpRight size={15}/></button></details>)}</section>
  <section className="ch-start" aria-labelledby="ch-start-title"><div><span className="ch-kicker"><BookOpen size={15}/>第一次使用</span><h2 id="ch-start-title">先试一份，再正式开始</h2><p>建议用示例模板熟悉字段和日期，再在测试公司走完一次确认。不要把演示数字填进正式报表。</p><a className="co-primary" href="/workbench/?space=company&preview=templates" target="_blank" rel="noreferrer">试用数据模板 <ArrowUpRight size={16}/><span className="ch-sr-only">（在新标签页打开）</span></a><a className="co-text" href="/workbench/help/quickstart.txt" target="_blank" rel="noreferrer">查看演示操作指南 <ArrowUpRight size={15}/></a></div><ol className="ch-flow" aria-label="一次完整填报流程"><li><span>01</span><strong>选模板</strong><small>确认字段与口径</small></li><li><span>02</span><strong>填事实</strong><small>核对日期与来源</small></li><li><span>03</span><strong>交确认</strong><small>由指定的另一人核实</small></li><li><span><Check size={17}/></span><strong>看汇总</strong><small>读取已确认结果</small></li></ol></section>
  <section className="ch-find" aria-label="查找使用帮助"><div className="ch-search"><Search size={18}/><input aria-label="搜索使用帮助" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索：导入、模板、确认、备份…" maxLength={100}/>{query&&<button type="button" onClick={()=>setQuery('')}>清空</button>}</div><div className="ch-role-filter" role="group" aria-label="按阅读角色筛选">{([{id:'mine',label:'与我相关'},{id:'all',label:'全部'},...allRoles.map(role=>({id:role,label:roleNames[role]}))] as {id:typeof filter;label:string}[]).map(item=><button key={item.id} type="button" aria-pressed={filter===item.id} className={filter===item.id?'selected':''} onClick={()=>setFilter(item.id)}>{item.label}</button>)}</div><p className="ch-filter-note"><UsersRound size={14}/>可切换角色查看指南；实际操作权限以当前账号及项目分配为准。</p></section>
  <section className="ch-guide-section" aria-labelledby="ch-guide-title"><div className="ch-section-heading"><h2 id="ch-guide-title">操作指南</h2><span role="status">{visible.length} 项{query.trim()?'匹配':''}</span></div><div className="ch-guide-grid">{visible.map(guide=><details className="ch-guide" key={guide.id} open={tokens.length?true:undefined}><summary><span className="ch-guide-icon"><guide.icon size={20}/></span><span className="ch-guide-label"><strong>{guide.title}</strong><small>{guide.intro}</small></span><ChevronDown className="ch-chevron" size={17}/></summary><div className="ch-guide-body"><ol>{guide.steps.map(step=><li key={step}>{step}</li>)}</ol>{guide.note&&<p className="ch-note">{guide.note}</p>}{guide.action&&allowed(guide.action.tab)&&<button type="button" className="co-text" onClick={()=>onNavigate(guide.action!.tab)}>{guide.action.label}<ArrowUpRight size={14}/></button>}</div></details>)}</div>{!visible.length&&<div className="ch-empty"><Search size={22}/><p>没有找到对应的操作指南。试试更短的关键词，或切换到“全部”。</p><button className="co-text" type="button" onClick={()=>{setQuery('');setFilter('all');}}>查看全部指南</button></div>}</section>
  <section className="ch-faq-section" aria-labelledby="ch-faq-title"><div className="ch-section-heading"><h2 id="ch-faq-title">常见问题</h2><span>{visibleFaqs.length} 项</span></div><div className="ch-faq-list">{visibleFaqs.map(faq=><details key={faq.question} open={tokens.length?true:undefined}><summary><span>{faq.question}</span><ChevronDown size={16}/></summary><p>{faq.answer}</p></details>)}</div>{!visibleFaqs.length&&<p className="ch-no-faq">没有匹配的常见问题，可尝试“累计”“来源”或“权限”。</p>}</section>
  <aside className="ch-responsibility"><ShieldCheck size={20}/><div><strong>数据来源，要有人负责</strong><p>系统帮助记录、计算与留痕；填写人提供真实原始事实，确认人核实来源和口径。缺失、估算或待核实的内容要明确说明，不编造数字，不用 0 代替未知。</p></div></aside>
 </div>;
}
