
'use strict';
const $ = id => document.getElementById(id);
const escaped = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fmt = (digits, max = digits) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: digits, maximumFractionDigits: max }).format;
const money = fmt(2), unit = fmt(2, 6), quantity = fmt(0, 6);
const dh = value => money(value) + ' DH';
const uid = () => globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
const stageOptions = Object.entries(CAE.stages), methodOptions = Object.entries(CAE.methods);
const archiveKey = 'atelier-cae.archive.v1';
const draftKey = 'atelier-cae.draft.v1';
const allowedSections = ['materials','products','centers','indirect','adjustments','directs'];
const maps = { products:['usage'], centers:['bases','transfers'], indirect:['keys'] };
const base = () => ({ name:'', company:'', period:'', method:'cmup', materials:[], products:[newRow('products')], centers:[], indirect:[], adjustments:[], directs:[] });
let opened = new Set(['general','materials','products']);
let draft = base(), archive = [], current = null, readError = '';

function newRow(section) {
  const item = { id:uid(), name:'' };
  if (section === 'centers') item.stage = 'production';
  for (const key of maps[section] ?? []) item[key] = {};
  return item;
}
function validData(data) {
  if (!data || typeof data !== 'object' || !Object.hasOwn(CAE.methods,data.method)) return false;
  return allowedSections.every(section => {
    const rows = data[section] ?? (section === 'directs' ? [] : null);
    if (!Array.isArray(rows) || rows.length > 150) return false;
    const ids = new Set();
    return rows.every(row => {
      if (!row || typeof row.id !== 'string' || !/^[a-z\d-]{1,80}$/i.test(row.id) || ids.has(row.id)) return false;
      ids.add(row.id);
      return (maps[section] ?? []).every(key => row[key] && typeof row[key] === 'object' && !Array.isArray(row[key]))
        && (section !== 'centers' || Object.hasOwn(CAE.stages,row.stage));
    });
  });
}
function validRecord(entry) {
  return entry && typeof entry.id === 'string' && /^[a-z\d-]{1,80}$/i.test(entry.id) &&
    typeof entry.date === 'string' && Number.isFinite(Date.parse(entry.date)) && validData(entry.data);
}
try {
  const savedDraft = JSON.parse(localStorage.getItem(draftKey) || 'null');
  if (validData(savedDraft)) draft = {...savedDraft,directs:savedDraft.directs??[]};
  const savedArchive = JSON.parse(localStorage.getItem(archiveKey) || '[]');
  if (!Array.isArray(savedArchive) || !savedArchive.every(validRecord)) throw new Error('Format d’archives invalide.');
  archive = savedArchive;
} catch {
  readError = 'Impossible de lire les données enregistrées sur ce navigateur.';
}
function notice(message, error = false) {
  $('notice').hidden = !message;
  $('notice').textContent = message;
  $('notice').className = error ? 'error' : '';
}
function saveDraft() {
  try { localStorage.setItem(draftKey, JSON.stringify(draft)); }
  catch { notice('Le brouillon n’a pas pu être enregistré sur ce navigateur.', true); }
}
function writeArchive(next) {
  if (readError) { notice(readError, true); return false; }
  try { localStorage.setItem(archiveKey, JSON.stringify(next)); }
  catch { notice('Impossible d’enregistrer les archives. Vérifiez l’espace et les permissions du navigateur.', true); return false; }
  archive = next;
  return true;
}
function reportError(message) {
  const error = $('errors');
  error.textContent = message;
  error.hidden = !message;
  if (message) error.focus();
}
function go(page) {
  if (location.hash !== '#' + page) location.hash = page;
  route();
}
function route() {
  const labels = { saisie:'Saisie du dossier', resultats:'Résultats', archives:'Archives' };
  const requested = location.hash.slice(1);
  const page = Object.hasOwn(labels, requested) ? requested : 'saisie';
  document.querySelectorAll('.page').forEach(section => { section.hidden = section.id !== page; });
  document.querySelectorAll('[data-page]').forEach(link => {
    if (link.dataset.page === page) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  $('breadcrumb').textContent = labels[page];
  if (page === 'resultats') renderReport();
  if (page === 'archives') renderArchive();
  window.scrollTo(0,0);
}
function titled(item, index, prefix) { return String(item.name ?? '').trim() || prefix + ' ' + (index + 1); }
function field(section, id, key, value, name, numeric = false, target = '') {
  return '<input type="text" ' + (numeric ? 'inputmode="decimal" placeholder="0" ' : 'maxlength="100" ') +
    'aria-label="' + escaped(name) + '" data-section="' + section + '" data-id="' + id + '" data-key="' + key + '" data-target="' + target +
    '" value="' + escaped(value) + '">';
}
function select(section,id,key,value,options,name) {
  return '<select aria-label="' + escaped(name) + '" data-section="' + section + '" data-id="' + id + '" data-key="' + key + '">' +
    options.map(([v,n]) => '<option value="' + v + '"' + (value === v ? ' selected' : '') + '>' + escaped(n) + '</option>').join('') + '</select>';
}
function table(headers, rows, input = false) {
  if (input) return entryCards(headers,rows);
  return '<div class="scroll" tabindex="0" role="region" aria-label="Tableau défilant"><table class="' + (input ? 'input-table' : '') + '"><thead><tr>' +
    headers.map(h => '<th scope="col">' + (typeof h === 'object' ? h.html : escaped(h)) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row =>
      '<tr' + (row.total ? ' class="total"' : '') + '>' + row.cells.map(cell => '<td>' + cell + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
}
const hint = text => '<p class="hint">' + escaped(text) + '</p>';
const subhead = text => '<h3 class="subhead">' + escaped(text) + '</h3>';
function panel(id, step, title, content, open) {
  return '<details class="panel" id="' + id + '"' + (open ? ' open' : '') + '><summary><span class="step">' + step + '</span>' +
    escaped(title) + '</summary><div class="panel-content">' + content + '</div></details>';
}
function rowTable(section, fields, addText) {
  const rows = draft[section].map((row,i) => ({ cells:[
    ...fields.map(([key,name,type]) => type === 'stage' ? select(section,row.id,key,row[key],stageOptions,name + ' ' + (i+1))
      : field(section,row.id,key,row[key],name + ' · ligne ' + (i+1),type === 'number')),
    '<button type="button" class="danger" data-remove="' + section + '" data-id="' + row.id + '" aria-label="Retirer la ligne ' + (i+1) + '">×</button>'
  ] }));
  return (rows.length ? table([...fields.map(f => f[1]),'Action'],rows,true) : '') +
    '<button type="button" class="quiet" data-add="' + section + '">＋ ' + addText + '</button>';
}
const generalField = (key,name) => '<label class="field">' + name + field('general','',key,draft[key],name) + '</label>';
const nameField = ['name','Libellé'];
const stockFields = [['oq','Stock initial · quantité','number'],['op','Stock initial · coût unitaire','number'],['real','Stock final réel (facultatif)','number']];
function renderForm() {
  const m = draft.materials, p = draft.products, c = draft.centers;
  const itemLabel = (item,i,type) => titled(item,i,type);
  const centerName = (item,i) => itemLabel(item,i,'Centre');
  const matName = (item,i) => itemLabel(item,i,'Matière');
  const prodName = (item,i) => itemLabel(item,i,'Produit');
  const itemText = (section,item,text) => '<span data-label-section="' + section + '" data-label-id="' + item.id + '">' + escaped(text) + '</span>';
  const column = (section,item,text,suffix = '') => ({html:itemText(section,item,text) + suffix});
  const matrixField = (section,row,key,item,title) => field(section,row.id,key,row[key][item.id],title,true,item.id);
  const usage = m.length && p.length ? subhead('Consommations de matières') + hint('Indiquez la quantité consommée par produit dans l’unité de la matière.') +
    table(['Produit',...m.map((item,i) => column('materials',item,matName(item,i)))],p.map((row,i) => ({cells:[itemText('products',row,prodName(row,i)),...m.map((item,j) => matrixField('products',row,'usage',item,prodName(row,i) + ' / ' + matName(item,j)))]})),true) : '';
  const indirectRows = draft.indirect.map((row,i) => ({cells:[
    field('indirect',row.id,'name',row.name,'Libellé de la charge ' + (i+1)),
    field('indirect',row.id,'total',row.total,'Montant de la charge ' + (i+1),true),
    ...c.map((item,j) => matrixField('indirect',row,'keys',item,'Clé en % / ' + centerName(item,j) + ' / charge ' + (i+1))),
    '<button type="button" class="danger" data-remove="indirect" data-id="' + row.id + '" aria-label="Retirer la charge ' + (i+1) + '">×</button>'
  ]}));
  const transferRows = c.flatMap((row,i) => row.stage === 'auxiliaire' ? [{cells:[
    itemText('centers',row,centerName(row,i)),
    ...c.map((item,j) => item === row ? '—' : matrixField('centers',row,'transfers',item,centerName(row,i) + ' → ' + centerName(item,j) + ' en %'))
  ]}] : []);
  const allocation = Object.entries({achat:m,production:p,distribution:p}).map(([stage,items]) => {
    const prefix = stage === 'achat' ? matName : prodName;
    const rows = c.flatMap((row,i) => row.stage === stage ? [{cells:[
      itemText('centers',row,centerName(row,i)),
      field('centers',row.id,'uo',row.uo,'Nature de l’unité d’œuvre de ' + centerName(row,i)),
      ...items.map((item,j) => matrixField('centers',row,'bases',item,'UO / ' + centerName(row,i) + ' / ' + prefix(item,j)))
    ]}] : []);
    return rows.length ? subhead(CAE.stages[stage]) + table(['Centre','Nature de l’UO',...items.map((item,i) => column(stage === 'achat' ? 'materials' : 'products',item,prefix(item,i)))],rows,true) : '';
  }).join('');
  const sections = [
    ['general','01','Dossier et méthode','<div class="field-grid">' + generalField('name','Nom du dossier') +
      generalField('company','Entreprise') + generalField('period','Période') + '<label class="field">Valorisation des stocks' +
      select('general','','method',draft.method,methodOptions,'Valorisation des stocks') + '</label></div>' +
      '<div id="stock-policy" style="margin-top:12px"' + (draft.method === 'cmup' ? ' hidden' : '') + '>' +
      hint('FIFO et LIFO utilisent deux lots par article : stock initial et entrée de période. La sortie de matière est valorisée globalement puis répartie au prorata des quantités consommées.') + '</div>'],
    ['materials','02','Matières, achats et charges directes d’achat',hint('Saisissez les quantités de stock et d’achat, le prix d’achat par unité et les frais directs d’achat en DH.') +
      rowTable('materials',[nameField,['workshop','Atelier consommateur (facultatif)'],...stockFields,['iq','Qté achetée','number'],['ip','Prix unitaire d’achat','number'],['buy','Frais directs d’achat','number']],'Ajouter une matière')],
    ['products','03','Produits, production et ventes',hint('Saisissez les charges directes et les en-cours en DH. Le prix de vente est unitaire.') +
      rowTable('products',[nameField,...stockFields,['made','Qté produite','number'],['sold','Qté vendue','number'],['price','Prix de vente unitaire','number'],['work','Autres charges directes de production','number'],['sell','Charges directes de distribution','number'],['wi','En-cours initial','number'],['wf','En-cours final','number']],'Ajouter un produit') + usage + directForm()],
    ['centers','04','Centres et charges indirectes',hint('Créez les centres utiles. Chaque ligne de charge est répartie par des clés en pourcentage.') +
      rowTable('centers',[nameField,['stage','Fonction','stage']],'Ajouter un centre') + subhead('Répartition primaire') +
      (indirectRows.length ? table(['Charge','Montant DH',...c.map((item,i) => column('centers',item,centerName(item,i),' %')),'Action'],indirectRows,true) : '') +
      '<button type="button" class="quiet" data-add="indirect">＋ Ajouter une charge indirecte</button>' +
      (transferRows.length ? subhead('Prestations entre centres') + hint('La ligne de chaque centre auxiliaire doit totaliser 100 %. Les prestations réciproques sont résolues simultanément.') +
        table(['Centre émetteur',...c.map((item,i) => column('centers',item,centerName(item,i),' %'))],transferRows,true) : '') +
      (allocation ? subhead('Unités d’œuvre par matière ou produit') + hint('Saisissez le nombre d’UO affecté à chaque destination, par exemple heures de MOD ou DH de ventes selon le centre.') + allocation : '')],
    ['adjustments','05','Rapprochement avec la comptabilité générale',hint('Facultatif. Saisissez chaque différence en DH avec son signe dans le passage du résultat analytique vers le résultat de la comptabilité générale.') +
      rowTable('adjustments',[nameField,['value','Différence signée en DH','number']],'Ajouter une différence')]
  ];
  $('form-content').innerHTML = sections.map(([id,n,title,content]) => panel(id,n,title,content,opened.has(id))).join('');
  applyGuidedStep();
}
function renderKeepingPanels() {
  opened = new Set([...$('form-content').querySelectorAll('details[open]')].map(el => el.id));
  renderForm();
}
function editField(event) {
  const {section,id,key,target} = event.target.dataset;
  if (!section) return;
  const row = section === 'general' ? draft : draft[section].find(item => item.id === id);
  if (target) row[key][target] = event.target.value;
  else row[key] = event.target.value;
  if (key === 'name' && section !== 'general') {
    const prefix = {materials:'Matière',products:'Produit',centers:'Centre'}[section];
    document.querySelectorAll('[data-label-section="' + section + '"][data-label-id="' + id + '"]').forEach(el => {
      el.textContent = titled(row,draft[section].indexOf(row),prefix);
    });
  }
  if (key === 'method') $('stock-policy').hidden = draft.method === 'cmup';
  current = null;
  reportError('');
  saveDraft();
}
function editRows(event) {
  const button = event.target.closest('[data-add],[data-remove]');
  if (!button) return;
  const section = button.dataset.add ?? button.dataset.remove;
  if (button.dataset.add) {
    if (draft[section].length >= 150) { notice('Limite de 150 lignes atteinte dans ce tableau.',true); return; }
    draft[section].push(newRow(section));
  } else {
    draft[section] = draft[section].filter(row => row.id !== button.dataset.id);
    const removedId = button.dataset.id;
    if (section === 'products') draft.directs = draft.directs.filter(line => line.product !== removedId);
    if (section === 'materials') draft.products.forEach(row => { delete row.usage[removedId]; });
    if (section === 'materials' || section === 'products') draft.centers.forEach(row => {
      if ((row.stage === 'achat') === (section === 'materials')) delete row.bases[removedId];
    });
    if (section === 'centers') {
      draft.centers.forEach(row => { delete row.transfers[removedId]; });
      draft.indirect.forEach(row => { delete row.keys[removedId]; });
    }
  }
  current = null;
  saveDraft();
  renderKeepingPanels();
}
function resultTable(headers, rows) {
  return table(headers, rows.map(row => ({total:row.total, cells:(row.cells ?? row).map(escaped)})));
}
function stockTable(stock, method) {
  const row = (name,q,pu,value) => [name,quantity(q),q ? unit(pu) : '—',money(value)];
  return subhead(stock.name) + resultTable(['Mouvement','Quantité','Coût unitaire DH','Montant DH'],[
    row('Stock initial',stock.openQty,stock.openPU,stock.initial),
    row('Entrées',stock.inQty,stock.incomingPU,stock.inValue),
    row('Disponible',stock.quantity,stock.average,stock.available),
    ...stock.layers.map(layer => row('Sortie du lot · ' + layer.name,layer.qty,layer.pu,layer.value)),
    row('Sorties',stock.outQty,stock.outQty ? stock.out / stock.outQty : 0,stock.out),
    {total:true,cells:row('Stock final',stock.finalQty,stock.finalQty ? stock.final / stock.finalQty : 0,stock.final)}
  ]) + (method !== 'cmup' ? hint('Lots valorisés dans l’ordre indiqué. Le coût unitaire des totaux est une moyenne informative.') : '');
}
function renderReport() {
  const root = $('report');
  if (!current) {
    $('result-subtitle').textContent = 'Calculez un dossier pour afficher les tableaux.';
    $('result-actions').innerHTML = '';
    root.innerHTML = '<div class="panel empty"><p>Aucun calcul à afficher.</p><a href="#saisie" class="button">Ouvrir la saisie</a></div>';
    return;
  }
  const {data, result, recordId} = current;
  $('result-subtitle').textContent = [dossierName(data), data.company, data.period, CAE.methods[data.method]].filter(Boolean).join(' · ');
  $('result-actions').innerHTML = '<a href="#saisie" class="button">Modifier les données</a><button type="button" id="print" class="secondary">Imprimer</button>' +
    (recordId ? '<span class="tag">Enregistré</span>' : '<button type="button" id="save" class="primary">Archiver ce calcul</button>');
  $('print').onclick = () => {
    const closed = [...root.querySelectorAll('details:not([open])')];
    closed.forEach(el => { el.open = true; });
    window.print();
    closed.forEach(el => { el.open = false; });
  };
  if (!recordId) $('save').onclick = () => {
    const entry = {id:uid(),date:new Date().toISOString(),data:structuredClone(current.data)};
    if (writeArchive([entry,...archive])) {
      current.recordId = entry.id;
      renderReport();
      notice('Calcul ajouté aux archives.');
    }
  };
  const moneyRow = (name, values) => [name,...values.map(money)];
  const group = (headers, lines, totals) => resultTable(headers, [
    ...lines.map(([name,values]) => moneyRow(name,values)),
    {total:true,cells:moneyRow(totals[0],totals[1])}
  ]);
  const centers = result.centers;
  const m = result.materials, p = result.products;
  const headers = ['Éléments',...p.map(item => item.name)];
  let distribution = hint('Aucun centre saisi dans ce dossier.');
  if (centers.length) {
    distribution = subhead('Répartition primaire et secondaire · DH') + resultTable(['Éléments','Total charges',...centers.map(c => c.name)],[
      ...result.primaryRows.map(row => [row.name,money(row.total),...row.values.map(money)]),
      {total:true,cells:['Totaux primaires',money(result.primaryRows.reduce((s,row) => s + row.total,0)),...centers.map(c => money(c.primary))]},
      ...result.secondaryRows.map(row => [row.name + ' · transfert','—',...row.values.map(money)]),
      {total:true,cells:['Totaux secondaires',money(result.principal.reduce((s,c) => s + c.secondary,0)),...centers.map(c => money(c.secondary))]}
    ]) + subhead('Coût de l’unité d’œuvre') + resultTable(['Centre','Nature de l’UO','Nombre d’UO','Montant DH','Coût par UO DH'],
      result.principal.map(c => [c.name,c.uo || '—',quantity(c.units),money(c.secondary),c.units ? unit(c.rate) : '—']));
    for (const stage of ['achat','production','distribution']) {
      const items = stage === 'achat' ? m : p;
      const rows = result.principal.filter(c => c.stage === stage);
      if (rows.length && items.length) distribution += subhead('Imputation · ' + CAE.stages[stage]) +
        resultTable(['Centre',...items.map(item => item.name)],rows.map(c => [c.name,...items.map(item => money(c.assigned[item.id]))]));
    }
  }
  const purchase = m.length ? resultTable(['Matière','Qté achetée','Prix d’achat total','Frais directs','Charges indirectes','Coût d’achat DH','Coût unitaire DH'],
    m.map(item => [item.name,quantity(item.inQty),money(item.gross),money(item.direct),money(item.indirect),money(item.inValue),item.inQty ? unit(item.incomingPU) : '—'])) : hint('Aucune matière saisie.');
  const materialStocks = m.map(item => stockTable(item,data.method)).join('') || hint('Aucun stock de matière à présenter.');
  const production = group(headers,[
    ...m.map(item => ['Consommation · ' + item.name,item.usage.map(q => q * item.issuePU)]),
    ['Charges directes de production',p.map(item => item.direct)],['Charges indirectes de production',p.map(item => item.indirect)],
    ['En-cours initial (+)',p.map(item => item.wi)],['En-cours final (−)',p.map(item => -item.wf)]
  ],['Coût de production des produits fabriqués',p.map(item => item.inValue)]) +
    resultTable(headers,[['Quantités produites',...p.map(item => quantity(item.inQty))],['Coût de production unitaire DH',...p.map(item => item.inQty ? unit(item.incomingPU) : '—')]]);
  const cost = group(headers,[
    ['Coût de production des produits vendus',p.map(item => item.out)],
    ['Charges directes de distribution',p.map(item => item.directSell)],['Charges indirectes de distribution',p.map(item => item.indirectSell)]
  ],['Coût de revient des produits vendus',p.map(item => item.cost)]);
  const margins = resultTable(['Produit','Qté vendue','Prix de vente unitaire','Chiffre d’affaires DH','Coût de revient DH','Coût de revient unitaire','Résultat unitaire','Résultat DH'],[
    ...p.map(item => [item.name,quantity(item.outQty),unit(item.price),money(item.revenue),money(item.cost),item.outQty ? unit(item.cost / item.outQty) : '—',item.outQty ? unit(item.profit / item.outQty) : '—',money(item.profit)]),
    {total:true,cells:['Total','—','—',money(result.revenue),money(result.cost),'—','—',money(result.profit)]}
  ]);
  const reconciliation = result.adjustments.length ? resultTable(['Éléments','Montant DH'],[
    ['Résultat analytique',money(result.profit)],...result.adjustments.map(row => [row.name,money(row.value)]),
    {total:true,cells:['Résultat de la comptabilité générale reconstitué',money(result.reconciliation)]}
  ]) : '';
  const panels = [
    ['r-marges','Résultats par produit',margins],['r-centres','Répartition',distribution],['r-achats','Coût d’achat',purchase],
    ['r-matieres','Stocks de matières',materialStocks],['r-production','Coût de production',production],
    ['r-produits','Stocks de produits finis',p.map(item => stockTable(item,data.method)).join('')],
    ['r-revient','Coût de revient',cost]
  ];
  if (reconciliation) panels.push(['r-rapprochement','Rapprochement',reconciliation]);
  root.innerHTML = '<div class="metrics"><div class="metric feature' + (result.profit < 0 ? ' loss' : '') +
    '"><span>Résultat analytique global</span><strong>' + dh(result.profit) + '</strong></div><div class="metric"><span>Chiffre d’affaires</span><strong>' +
    dh(result.revenue) + '</strong></div><div class="metric"><span>Coût de revient global</span><strong>' + dh(result.cost) + '</strong></div></div>' +
    '<div class="jump" aria-label="Accéder à un tableau">' + panels.map(([id,title]) => '<button type="button" data-jump="' + id + '">' + title + '</button>').join('') + '</div>' +
    panels.map(([id,title,html],i) => panel(id,String(i+1).padStart(2,'0'),title,html,i === 0)).join('') +
    hint('Les coûts unitaires sont affichés jusqu’à six décimales. Les calculs utilisent les valeurs non arrondies.');
}
function dossierName(data) { return String(data.name ?? '').trim() || 'Dossier sans titre'; }
function loadData(data) {
  guidedIndex=0;
  draft = structuredClone(data);
  draft.directs ??= [];
  current = null;
  opened = new Set(['general','materials','products']);
  reportError('');
  saveDraft();
  renderForm();
}
function download(filename, content) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:'application/json'}));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderArchive() {
  const container = $('archive-list');
  if (!archive.length) {
    container.innerHTML = '<div class="panel empty"><p>Aucun dossier archivé.</p><a class="button" href="#saisie">Créer un calcul</a></div>';
    return;
  }
  container.innerHTML = '<div class="panel"><div class="archive-head"><input id="search" type="search" placeholder="Rechercher un dossier, une entreprise ou une période" aria-label="Rechercher dans les archives"></div><div id="archive-rows"></div></div>';
  function filter() {
    const query = $('search').value.trim().toLocaleLowerCase('fr');
    $('archive-rows').innerHTML = archive.filter(entry => [dossierName(entry.data),entry.data.company,entry.data.period].join(' ').toLocaleLowerCase('fr').includes(query)).map(entry => {
      const {data,date,id} = entry;
      return '<div class="archive-row"><div><strong>' + escaped(dossierName(data)) + '</strong><p>' +
        escaped([data.company,data.period,CAE.methods[data.method],new Date(date).toLocaleString('fr-MA')].filter(Boolean).join(' · ')) +
        '</p></div><div class="actions"><button class="secondary" data-open="' + id + '">Ouvrir</button><button class="secondary" data-export="' + id +
        '">Exporter</button><button class="secondary danger" data-delete="' + id + '">Supprimer</button></div></div>';
    }).join('') || '<div class="empty">Aucun dossier ne correspond à la recherche.</div>';
  }
  $('search').addEventListener('input',filter);
  filter();
}
function example() {
  return {
    name:'Exemple pédagogique · Nova',company:'Atelier Nova',period:'Juin',method:'cmup',
    materials:[{id:'m',name:'Matière M',oq:'20',op:'8',iq:'80',ip:'10',buy:'40'}],
    products:[
      {id:'a',name:'Produit A',oq:'10',op:'20',made:'40',sold:'30',price:'30',work:'160',sell:'20',wi:'20',wf:'24',usage:{m:'40'}},
      {id:'b',name:'Produit B',made:'20',sold:'20',price:'25',work:'70',usage:{m:'20'}}
    ],
    centers:[
      {id:'s',name:'Services généraux',stage:'auxiliaire',transfers:{ap:'50',p:'50'},bases:{}},
      {id:'ap',name:'Approvisionnement',stage:'achat',uo:'kg achetés',transfers:{},bases:{m:'80'}},
      {id:'p',name:'Atelier',stage:'production',uo:'heures de MOD',transfers:{},bases:{a:'40',b:'20'}},
      {id:'d',name:'Distribution',stage:'distribution',uo:'unités vendues',transfers:{},bases:{a:'30',b:'20'}}
    ],
    indirect:[{id:'charges',name:'Charges indirectes incorporables',total:'200',keys:{s:'20',ap:'10',p:'50',d:'20'}}],
    adjustments:[]
  };
}
$('form').addEventListener('input',editField);
$('form').addEventListener('change',event => {
  if (event.target.tagName === 'SELECT' && event.target.dataset.section === 'centers') renderKeepingPanels();
});
$('form').addEventListener('click',editRows);
$('form').addEventListener('submit',event => {
  event.preventDefault();
  notice('');
  try {
    const data = structuredClone(draft);
    current = {data,result:CAE.calculate(data)};
    reportError('');
    go('resultats');
  } catch (error) {
    current = null;
    reportError(error.message);
  }
});
$('report').addEventListener('click',event => {
  const target = event.target.closest('[data-jump]');
  if (target) {
    const details = $(target.dataset.jump);
    details.open = true;
    details.querySelector('summary').focus();
    details.scrollIntoView({block:'start'});
  }
});
$('demo').onclick = () => {
  if (!confirm('Charger l’exemple et remplacer les données de saisie actuelles ?')) return;
  loadData(pepCase());
  current = {data:structuredClone(draft),result:CAE.calculate(draft)};
  notice('');
  go('resultats');
};
$('new').onclick = () => {
  if (!confirm('Commencer un dossier vide et remplacer les données de saisie actuelles ?')) return;
  loadData(base());
  notice('Nouveau dossier prêt.');
};
$('archive-list').addEventListener('click',event => {
  const button = event.target.closest('[data-open],[data-export],[data-delete]');
  if (!button) return;
  const {open,export:exportId,delete:deleteId} = button.dataset;
  const entry = archive.find(item => item.id === (open ?? exportId ?? deleteId));
  if (open) {
    if (!confirm('Ouvrir ce dossier archivé et remplacer les données de saisie actuelles ?')) return;
    try {
      const result = CAE.calculate(entry.data);
      loadData(entry.data);
      current = {data:structuredClone(entry.data),result,recordId:entry.id};
      notice('');
      go('resultats');
    } catch (error) { notice(error.message,true); }
  } else if (exportId) {
    download('dossier-cae.json',{version:1,records:[entry]});
  } else if (confirm('Supprimer ce dossier des archives ?') && writeArchive(archive.filter(item => item !== entry))) {
    if (current?.recordId === entry.id) current.recordId = null;
    notice('Dossier supprimé des archives.');
    renderArchive();
  }
});
$('backup').onclick = () => {
  if (archive.length) download('archives-cae.json',{version:1,records:archive});
  else notice('Aucun dossier à exporter.',true);
};
$('import').onclick = () => $('file').click();
$('file').addEventListener('change',async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('Le fichier dépasse 5 Mo.');
    const imported = JSON.parse(await file.text());
    if (imported?.version !== 1 || !Array.isArray(imported.records) || !imported.records.every(validRecord)) {
      throw new Error('Sélectionnez un dossier ou une sauvegarde JSON exporté depuis Atelier CAE.');
    }
    const ids = new Set(archive.map(entry => entry.id));
    const incoming = imported.records.filter(entry => {
      if (ids.has(entry.id)) return false;
      CAE.calculate(entry.data);
      ids.add(entry.id);
      return true;
    });
    if (!incoming.length) { notice('Aucun nouveau dossier à importer.'); return; }
    if (writeArchive([...incoming,...archive].sort((a,b) => Date.parse(b.date) - Date.parse(a.date)))) {
      renderArchive();
      notice(incoming.length + ' dossier(s) importé(s).');
    }
  } catch (error) { notice('Import impossible. ' + error.message,true); }
});
function installCourse() {
  const add = values => values.reduce((a,b)=>a+b,0);
  const total = cells => ({total:true,cells});
  const empty = ["—","—","—"];
  const triplet = (q,v) => [q == null ? "—" : quantity(q),q ? unit(v/q) : "—",money(v)];
  const raw = (value,label) => {
    const text=String(value??"").trim().replace(/[ \u00a0\u202f]/g,"").replace(",",".");
    if ((text && !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) || Number(text)>1e12) {
      throw Error(label+" · indiquez une valeur positive ou nulle.");
    }
    return Number(text);
  };
  const compute=CAE.calculate;
  CAE.calculate = data => {
    const directRows=(data.directs??[]).map((line,i)=>{
      const product=data.products.find(p=>p.id===line.product);
      if(!product) throw Error("Charge directe "+(i+1)+" · sélectionnez un produit.");
      const q=raw(line.qty,"Quantité"),rate=raw(line.rate,"Coût unitaire");
      return {name:line.name||"Charge directe "+(i+1),product:product.id,group:line.group,q,value:q*rate};
    });
    const prepared={...data,products:data.products.map(p=>({
      ...p,work:String(raw(p.work,p.name)+add(directRows.filter(l=>l.product===p.id).map(l=>l.value)))
    }))};
    const r=compute(prepared);
    const inventory=[];
    for(const [stocks,inputs] of [[r.materials,data.materials],[r.products,data.products]]){
      for(const s of stocks){
        const input=inputs.find(x=>x.id===s.id);
        if(String(input.real??"").trim()==="") continue;
        if(data.method!=="cmup") throw Error(s.name+" · l’écart de stock automatique est disponible avec le CMUP de fin de période.");
        s.real=raw(input.real,s.name+" / stock réel");
        s.delta=s.real-s.finalQty;
        if(Math.abs(s.delta)<1e-8)s.delta=0;
        s.change=s.delta*s.average;
        if(s.delta) inventory.push({name:(s.delta<0?"Mali · ":"Boni · ")+s.name,value:s.change});
      }
    }
    r.adjustments.push(...inventory);
    r.reconciliation+=add(inventory.map(a=>a.value));
    r.directRows=directRows;
    return r;
  };
  function grouped(left,groups,rows){
    return '<div class="scroll" tabindex="0"><table><thead><tr>'+left.map(h=>'<th rowspan="2">'+escaped(h)+'</th>').join('')+
      groups.map(h=>'<th colspan="3" scope="colgroup">'+escaped(h)+'</th>').join('')+
      '</tr><tr>'+groups.map(()=>'<th>Qté</th><th>C.U.</th><th>Montant</th>').join('')+'</tr></thead><tbody>'+
      rows.map(r=>'<tr'+(r.total?' class="total"':'')+'>'+(r.cells??r).map(x=>'<td>'+escaped(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  function inventoryTable(s){
    const blank=["—",...empty];
    const left=[["Stock initial",...triplet(s.openQty,s.initial)],["Entrées",...triplet(s.inQty,s.inValue)]];
    const right=s.layers.length?s.layers.map(l=>["Sorties · "+l.name,...triplet(l.qty,l.value)]):[["Sorties",...triplet(s.outQty,s.out)]];
    right.push(s.real===undefined?["Stock final",...triplet(s.finalQty,s.final)]:["Stock final réel",...triplet(s.real,s.real*s.average)]);
    if(s.delta<0)right.push(["Mali d’inventaire",...triplet(-s.delta,-s.change)]);
    if(s.delta>0)left.push(["Boni d’inventaire",...triplet(s.delta,s.change)]);
    const rows=Array.from({length:Math.max(left.length,right.length)},(_,i)=>[...(left[i]??blank),...(right[i]??blank)]);
    const t=["TOTAL",...triplet(s.quantity+Math.max(s.delta??0,0),s.available+Math.max(s.change??0,0))];
    const hdr='<tr><th colspan="4" scope="colgroup">Débit</th><th colspan="4" scope="colgroup">Crédit</th></tr>';
    return subhead(s.name)+resultTable(["Éléments","Qté","C.U.","Montant","Éléments","Qté","C.U.","Montant"],[...rows,total([...t,...t])]).replace("<thead>","<thead>"+hdr)+
      (s.real===undefined?"":hint("Stock théorique : "+quantity(s.finalQty)+" · CMUP : "+unit(s.average)+" DH."));
  }
  function courseTables(data,r){
    const m=r.materials,p=r.products,c=r.centers,pc=r.principal;
    const stage=s=>pc.filter(x=>x.stage===s);
    const uo=(center,id)=>raw(center.bases[id],"Unité d’œuvre");
    const prows=(label,get,footer=false)=>{
      const line=[label,...p.flatMap(get)];
      return footer?total(line):line;
    };
    const sections=[];
    const push=(id,title,html)=>sections.push([id,title,html]);
    const distribution=c.length?resultTable(["Éléments","Total",...c.map(x=>x.name)],[
      ...r.primaryRows.map(x=>[x.name,money(x.total),...x.values.map(money)]),
      total(["Totaux primaires",money(add(c.map(x=>x.primary))),...c.map(x=>money(x.primary))]),
      ...r.secondaryRows.map(x=>[x.name,"—",...x.values.map(money)]),
      total(["T.R.S.",money(add(pc.map(x=>x.secondary))),...c.map(x=>money(x.secondary))]),
      ["Nature de l’UO","—",...c.map(x=>x.uo||"—")],
      ["Nombre d’UO","—",...c.map(x=>x.units===undefined?"—":quantity(x.units))],
      ["Coût de l’UO","—",...c.map(x=>x.rate===undefined?"—":unit(x.rate))]
    ]):hint("Aucun centre.");
    push("r-centres","Tableau de répartition des charges indirectes",distribution);
    if(m.length){
      push("r-achats","Coût d’achat",grouped(["Éléments"],m.map(x=>x.name),[
        ["Prix d’achat",...m.flatMap(x=>triplet(x.inQty,x.gross))],
        ...(m.some(x=>x.direct)?[["Frais directs d’achat",...m.flatMap(x=>triplet(null,x.direct))]]:[]),
        ...stage("achat").map(c=>[c.name,...m.flatMap(x=>triplet(uo(c,x.id),c.assigned[x.id]))]),
        total(["Coût d’achat",...m.flatMap(x=>triplet(x.inQty,x.inValue))])
      ]));
      push("r-matieres","Compte d’inventaire permanent des matières",m.map(inventoryTable).join(""));
    }
    const lines=[
      ...m.map((x,i)=>({group:data.materials[i].workshop,label:x.name,trip:(p,j)=>triplet(x.usage[j],x.usage[j]*x.issuePU)})),
      ...r.directRows.map(x=>({group:x.group,label:x.name,trip:p=>p.id===x.product?triplet(x.q,x.value):empty})),
      ...stage("production").map(c=>({group:c.name,label:"Charges indirectes · "+c.name,trip:p=>triplet(uo(c,p.id),c.assigned[p.id])}))
    ];
    const groupNames=[...new Set([...stage("production").map(c=>c.name),...lines.map(x=>x.group||"")])];
    const production=groupNames.flatMap(group=>lines.filter(x=>(x.group||"")===group).map(x=>[group||"—",x.label,...p.flatMap(x.trip)]));
    if(data.products.some(x=>raw(x.work,x.name)))production.push(["—","Autres charges directes",...data.products.flatMap(x=>triplet(null,raw(x.work,x.name)))]);
    if(p.some(x=>x.wi))production.push(["—","En-cours initial (+)",...p.flatMap(x=>triplet(null,x.wi))]);
    if(p.some(x=>x.wf))production.push(["—","En-cours final (−)",...p.flatMap(x=>triplet(null,-x.wf))]);
    production.push(total(["—","Coût de production",...p.flatMap(x=>triplet(x.inQty,x.inValue))]));
    push("r-production","Coût de production",grouped(["Atelier","Éléments"],p.map(x=>x.name),production));
    push("r-produits","Compte d’inventaire permanent des produits finis",p.map(inventoryTable).join(""));
    push("r-revient","Coût de revient",grouped(["Éléments"],p.map(x=>x.name),[
      prows("Coût de production des produits vendus",x=>triplet(x.outQty,x.out)),
      ...(p.some(x=>x.directSell)?[prows("Charges directes de distribution",x=>triplet(null,x.directSell))]:[]),
      ...stage("distribution").map(c=>prows(c.name,x=>triplet(uo(c,x.id),c.assigned[x.id]))),
      prows("Coût de revient",x=>triplet(x.outQty,x.cost),true)
    ]));
    push("r-marges","Résultat analytique",grouped(["Éléments"],p.map(x=>x.name),[
      prows("Prix de vente",x=>triplet(x.outQty,x.revenue)),
      prows("Coût de revient",x=>triplet(x.outQty,x.cost)),
      prows("Résultat analytique",x=>triplet(x.outQty,x.profit),true)
    ]));
    if(r.adjustments.length){
      const rows=[{name:"Résultat analytique",value:r.profit},...r.adjustments,{name:"Résultat de la comptabilité générale",value:-r.reconciliation}];
      const credit=add(rows.filter(x=>x.value>0).map(x=>x.value));
      const debit=-add(rows.filter(x=>x.value<0).map(x=>x.value));
      push("r-rapprochement","Tableau de concordance des résultats",resultTable(["Éléments","Débit (−)","Crédit (+)"],[
        ...rows.map(x=>[x.name,x.value<0?money(-x.value):"—",x.value>=0?money(x.value):"—"]),
        total(["TOTAL",money(debit),money(credit)])
      ]));
    }
    return sections;
  }
  const original=renderReport;
  renderReport=()=>{
    original();
    if(!current)return;
    const root=$("report"),sections=courseTables(current.data,current.result);
    const nav=root.querySelector(".jump");
    while(nav.nextSibling)nav.nextSibling.remove();
    nav.innerHTML=sections.map(([id,title])=>'<button type="button" data-jump="'+id+'">'+escaped(title)+'</button>').join("");
    root.insertAdjacentHTML("beforeend",sections.map(([id,title,html],i)=>panel(id,String(i+1).padStart(2,"0"),title,html,true)).join(""));
  };
}
function directForm() {
  const rows=draft.directs.map(line=>({cells:[
    field("directs",line.id,"name",line.name,"Libellé"),
    select("directs",line.id,"product",line.product,[["","Choisir"],...draft.products.map((p,i)=>[p.id,titled(p,i,"Produit")])],"Produit"),
    field("directs",line.id,"group",line.group,"Atelier"),
    field("directs",line.id,"qty",line.qty,"Quantité",true),
    field("directs",line.id,"rate",line.rate,"Coût unitaire",true),
    '<button type="button" class="danger" data-remove="directs" data-id="'+line.id+'" aria-label="Retirer la charge">×</button>'
  ]}));
  return subhead("Détail des charges directes de production")+
    hint("Indiquez le nom exact de l’atelier. Pour une charge forfaitaire, saisissez 1 et son montant. Réservez « Autres charges directes » aux montants non détaillés.")+
    (rows.length?table(["Libellé","Produit","Atelier","Qté","C.U.","Action"],rows,true):"")+
    '<button type="button" class="quiet" data-add="directs">＋ Ajouter une charge directe</button>';
}
function pepCase(){
  const materials=[
    {id:"poulets",name:"Poulets",workshop:"Atelier 1",oq:300,op:25,iq:1200,ip:25,real:350},
    {id:"epices",name:"Épices (lot)",workshop:"Atelier 2",iq:1,ip:3750,real:0},
    {id:"boites",name:"Boîtes vides",workshop:"Conditionnement",oq:1000,op:2.524,iq:6000,ip:2.4,real:1600}
  ];
  const specs=[
    ["appro","Approvisionnement","achat","100 DH d’achats",1926,{poulets:300,epices:37.5,boites:144}],
    ["a1","Atelier 1","production","Poulet traité",3850,{pate:1100}],
    ["a2","Atelier 2","production","Heure machine",7300,{pate:2000}],
    ["cond","Conditionnement","production","Boîte conditionnée",6600,{pate:5280}],
    ["dist","Distribution","distribution","Boîte vendue",7800,{pate:5200}]
  ];
  return {name:"Cas n° 10 · Entreprise PEP",company:"PEP",period:"Août 2010",method:"cmup",materials,
    products:[{id:"pate",name:"Boîtes de pâté de poulet",oq:720,op:String(12120/720),made:5280,sold:5200,price:21,real:780,usage:{poulets:1100,epices:1,boites:5280}}],
    centers:specs.map(([id,name,stage,uo,,bases])=>({id,name,stage,uo,bases,transfers:{}})),
    indirect:specs.map(([id,name,,,total])=>({id:"trs-"+id,name:"T.R.S. · "+name,total,keys:{[id]:100}})),
    directs:[
      ["Atelier 1","Main-d’œuvre directe",550,8.5],
      ["Atelier 1","Évacuation des déchets",1,2695],
      ["Atelier 2","Main-d’œuvre directe",200,10],
      ["Conditionnement","Main-d’œuvre directe",528,10]
    ].map(([group,name,qty,rate],i)=>({id:"direct-"+i,product:"pate",group,name,qty,rate})),
    adjustments:[{id:"sup",name:"Charges supplétives",value:2500},{id:"prov",name:"Provisions non incorporables",value:-286}]
  };
}

const guidedSteps = [
  ["general","Dossier","Donnez un nom au dossier et choisissez la méthode indiquée dans l’exercice."],
  ["materials","Matières et achats","Ajoutez une fiche pour chaque matière ou emballage. Saisissez les quantités et les prix unitaires."],
  ["products","Production et ventes","Ajoutez les produits, puis indiquez les matières consommées sous leurs fiches."],
  ["centers","Charges indirectes","Créez d’abord les centres, puis renseignez les charges, les clés de répartition et les unités d’œuvre."],
  ["adjustments","Concordance","Ajoutez les différences de comptabilité générale si l’exercice en indique, puis lancez le calcul."]
];
let guidedIndex=0;

function entryCards(headers,rows){
  const optionalKeys=new Set(["workshop","real","buy","work","sell","wi","wf"]);
  const captions={materials:"Matière",products:"Produit",centers:"Centre",indirect:"Charge indirecte",directs:"Charge directe",adjustments:"Différence"};
  return '<div class="entry-cards">'+rows.map((row,index)=>{
    const main=[],extra=[];
    let title="",remove="";
    row.cells.forEach((cell,i)=>{
      if(cell.includes("data-remove=")){
        remove=cell.replace(">×</button>",">Retirer</button>");
        return;
      }
      if(i===0&&!/^<(input|select)\b/.test(cell)){
        title=cell;
        return;
      }
      if(cell==="—")return;
      const header=headers[i];
      const label=typeof header==="object"?header.html:escaped(header);
      const key=cell.match(/data-key="([^"]+)"/)?.[1];
      const html='<label class="entry-field"><span>'+label+'</span>'+cell+'</label>';
      (optionalKeys.has(key)?extra:main).push(html);
    });
    const type=row.cells[0].match(/data-section="([^"]+)"/)?.[1];
    const caption=title||escaped((captions[type]||"Ligne")+" "+(index+1));
    const filled=extra.some(line=>/ value="[^"]+"/.test(line));
    return '<div class="entry-card"><div class="entry-head"><strong>'+caption+'</strong>'+remove+
      '</div><div class="entry-fields">'+main.join("")+'</div>'+
      (extra.length?'<details class="entry-extra"><summary>Détails facultatifs'+(filled?' · renseignés':'')+
        '</summary><div class="entry-fields">'+extra.join("")+'</div></details>':'')+'</div>';
  }).join("")+'</div>';
}

function applyGuidedStep(){
  guidedSteps.forEach(([id],i)=>{
    const section=$(id),button=$("guided-"+id);
    section.hidden=i!==guidedIndex;
    section.open=i===guidedIndex;
    if(i===guidedIndex)button.setAttribute("aria-current","step");
    else button.removeAttribute("aria-current");
  });
  $("guided-hint").textContent="Étape "+(guidedIndex+1)+" sur "+guidedSteps.length+" · "+guidedSteps[guidedIndex][2];
  $("guided-prev").hidden=guidedIndex===0;
  $("guided-next").hidden=guidedIndex===guidedSteps.length-1;
  $("guided-calculate").classList.toggle("secondary",guidedIndex!==guidedSteps.length-1);
  $("guided-calculate").classList.toggle("primary",guidedIndex===guidedSteps.length-1);
}

function setGuidedStep(index){
  guidedIndex=Math.min(Math.max(index,0),guidedSteps.length-1);
  applyGuidedStep();
  $("guided-"+guidedSteps[guidedIndex][0]).focus();
}

function initGuided(){
  $("guided-nav").innerHTML=guidedSteps.map(([id,title],i)=>
    '<button type="button" class="secondary" id="guided-'+id+'"><span>'+(i+1)+'</span> '+escaped(title)+'</button>').join("");
  guidedSteps.forEach(([id],i)=>{$("guided-"+id).onclick=()=>setGuidedStep(i);});
  $("guided-prev").onclick=()=>setGuidedStep(guidedIndex-1);
  $("guided-next").onclick=()=>setGuidedStep(guidedIndex+1);
}

initGuided();
installCourse();
window.addEventListener('hashchange',route);
if (!draft.name && !draft.materials.length && !draft.products.some(p=>p.name) && !location.hash) {
  loadData(pepCase());
  current={data:structuredClone(draft),result:CAE.calculate(draft)};
  go('resultats');
} else {
  renderForm();
  if (location.hash === '#resultats') {
    try { current={data:structuredClone(draft),result:CAE.calculate(draft)}; } catch { current=null; }
  }
  route();
}
if (readError) notice(readError,true);

