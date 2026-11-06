
(function (root) {
  'use strict';
  const stages = { achat: 'Approvisionnement', production: 'Production', distribution: 'Distribution', auxiliaire: 'Auxiliaire' };
  const methods = { cmup: 'CMUP de fin de période', fifo: 'FIFO (PEPS)', lifo: 'LIFO (DEPS)' };
  const sum = values => values.reduce((a, b) => a + b, 0);
  const near = (a, b) => Math.abs(a - b) <= Math.max(1e-8, 8 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b)));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const amount = (value, name, signed = false) => {
    const normalized = String(value ?? '').trim().replace(/[ \u00a0\u202f]/g, '').replace(',', '.');
    const number = Number(normalized);
    assert((normalized === '' || /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) && Number.isFinite(number)
      && Math.abs(number) <= 1e12 && (signed || number >= 0), name + ' · saisissez un nombre ' + (signed ? 'valide' : 'positif ou nul') + '.');
    return number;
  };
  const label = (value, fallback) => String(value ?? '').trim() || fallback;
  function solve(matrix, values) {
    const rows = matrix.map((row, i) => [...row, values[i]]);
    const n = rows.length;
    for (let i = 0; i < n; i++) {
      let pivot = i;
      for (let j = i + 1; j < n; j++) if (Math.abs(rows[j][i]) > Math.abs(rows[pivot][i])) pivot = j;
      assert(Math.abs(rows[pivot][i]) > 1e-10, 'Répartition secondaire impossible. Vérifiez que chaque centre auxiliaire transfère, directement ou indirectement, vers un centre principal.');
      [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
      const divisor = rows[i][i];
      rows[i] = rows[i].map(value => value / divisor);
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const factor = rows[j][i];
        rows[j] = rows[j].map((value, k) => value - factor * rows[i][k]);
      }
    }
    return rows.map(row => row[n]);
  }
  function inventory(openQty, openPU, inQty, inValue, outQty, method, name) {
    const initial = openQty * openPU;
    const quantity = openQty + inQty;
    const available = initial + inValue;
    assert(outQty <= quantity || near(outQty, quantity), name + ' · sortie supérieure au stock disponible.');
    outQty = Math.min(outQty, quantity);
    const incomingPU = inQty ? inValue / inQty : 0;
    const average = quantity ? available / quantity : 0;
    const layers = [{ name: 'Stock initial', qty: openQty, pu: openPU }, { name: 'Entrées de la période', qty: inQty, pu: incomingPU }];
    if (method === 'lifo') layers.reverse();
    let remaining = outQty;
    const used = layers.map(layer => {
      const qty = Math.min(remaining, layer.qty);
      remaining -= qty;
      return { name: layer.name, qty, pu: layer.pu, value: qty * layer.pu };
    }).filter(layer => layer.qty > 0);
    const out = method === 'cmup' ? outQty * average : sum(used.map(layer => layer.value));
    const finalQty = quantity - outQty;
    const final = finalQty ? available - out : 0;
    return { name, openQty, openPU, initial, inQty, incomingPU, inValue, quantity, available, average, outQty, out, finalQty, final, layers: method === 'cmup' ? [] : used };
  }
  function calculate(data) {
    const { materials, products, centers, indirect, method } = data;
    assert(Object.hasOwn(methods, method), 'Choisissez une méthode de valorisation.');
    assert(products.length > 0, 'Ajoutez au moins un produit.');
    const qty = (item, key) => amount(item[key], item.name + ' / ' + ({oq:'Stock initial', op:'Coût unitaire initial', iq:'Quantité achetée', ip:'Prix unitaire d’achat', made:'Quantité produite', sold:'Quantité vendue', price:'Prix de vente', buy:'Charges directes d’achat', work:'Charges directes de production', sell:'Charges directes de distribution', wi:'En-cours initial', wf:'En-cours final'}[key] ?? key));
    const itemName = (item, type, index) => label(item.name, type + ' ' + (index + 1));
    const mat = materials.map((m, i) => ({ ...m, name: itemName(m, 'Matière', i) }));
    const prod = products.map((p, i) => ({ ...p, name: itemName(p, 'Produit', i) }));
    const ct = centers.map((c, i) => ({ ...c, name: itemName(c, 'Centre', i), primary: 0 }));
    const aux = ct.filter(c => c.stage === 'auxiliaire');
    const principal = ct.filter(c => c.stage !== 'auxiliaire');
    const primaryRows = indirect.map((row, i) => {
      const name = itemName(row, 'Charge', i);
      const total = amount(row.total, name);
      const keys = ct.map(c => amount(row.keys[c.id], name + ' / ' + c.name));
      assert(near(sum(keys), 100) || (total === 0 && sum(keys) === 0), name + ' · les clés de répartition primaire doivent totaliser 100 %.');
      const values = keys.map(key => total * key / 100);
      ct.forEach((c, j) => { c.primary += values[j]; });
      return { name, total, keys, values };
    });
    function transfer(from, to) { return amount(from.transfers[to.id], from.name + ' → ' + to.name) / 100; }
    aux.forEach(from => {
      assert(near(sum(ct.filter(to => to !== from).map(to => transfer(from, to))), 1), from.name + ' · les prestations vers les autres centres doivent totaliser 100 %.');
    });
    const totals = solve(aux.map(to => aux.map(from => from === to ? 1 : -transfer(from, to))), aux.map(c => c.primary));
    const secondaryRows = aux.map((c, i) => ({ name: c.name, total: totals[i], values: ct.map(to => to === c ? -totals[i] : totals[i] * transfer(c, to)) }));
    ct.forEach((c, i) => { c.secondary = c.primary + sum(secondaryRows.map(row => row.values[i])); });
    principal.forEach(c => {
      assert(['achat', 'production', 'distribution'].includes(c.stage), c.name + ' · choisissez une fonction.');
      const items = c.stage === 'achat' ? mat : prod;
      const bases = items.map(item => amount(c.bases[item.id], c.name + ' / UO ' + item.name));
      c.units = sum(bases);
      assert(c.units > 0 || near(c.secondary, 0), c.name + ' · indiquez des unités d’œuvre pour imputer son montant.');
      c.rate = c.units ? c.secondary / c.units : 0;
      c.assigned = Object.fromEntries(items.map((item, i) => [item.id, c.rate * bases[i]]));
    });
    assert(near(sum(principal.map(c => c.secondary)), sum(primaryRows.map(row => row.total))), 'Le total des centres principaux diffère des charges indirectes saisies.');
    const imput = (stage, id) => sum(principal.filter(c => c.stage === stage).map(c => c.assigned[id]));
    const materialRows = mat.map(m => {
      const iq = qty(m, 'iq');
      const gross = iq * qty(m, 'ip');
      const direct = qty(m, 'buy');
      const indirect = imput('achat', m.id);
      const value = gross + direct + indirect;
      assert(iq > 0 || near(value, 0), m.name + ' · coût d’achat affecté sans quantité achetée.');
      const usage = prod.map(p => amount(p.usage[m.id], p.name + ' / consommation de ' + m.name));
      const stock = inventory(qty(m, 'oq'), qty(m, 'op'), iq, value, sum(usage), method, m.name);
      const issuePU = stock.outQty ? stock.out / stock.outQty : 0;
      return { ...stock, id: m.id, gross, direct, indirect, usage, issuePU };
    });
    const productRows = prod.map((p, i) => {
      const made = qty(p, 'made');
      const sold = qty(p, 'sold');
      const materialsCost = sum(materialRows.map(m => m.usage[i] * m.issuePU));
      const direct = qty(p, 'work');
      const indirect = imput('production', p.id);
      const wi = qty(p, 'wi');
      const wf = qty(p, 'wf');
      const production = materialsCost + direct + indirect + wi - wf;
      assert(production >= 0 || near(production, 0), p.name + ' · l’en-cours final dépasse les coûts disponibles.');
      assert(made > 0 || near(production, 0), p.name + ' · coût de production affecté sans quantité produite.');
      const stock = inventory(qty(p, 'oq'), qty(p, 'op'), made, Math.max(0, production), sold, method, p.name);
      const directSell = qty(p, 'sell');
      const indirectSell = imput('distribution', p.id);
      const price = qty(p, 'price');
      const revenue = stock.outQty * price;
      const cost = stock.out + directSell + indirectSell;
      return { ...stock, id: p.id, materialsCost, direct, indirect, wi, wf, directSell, indirectSell, price, revenue, cost, profit: revenue - cost };
    });
    const revenue = sum(productRows.map(p => p.revenue));
    const cost = sum(productRows.map(p => p.cost));
    const profit = revenue - cost;
    const adjustments = data.adjustments.map((row, i) => ({ name: itemName(row, 'Différence', i), value: amount(row.value, itemName(row, 'Différence', i), true) }));
    return { method, centers: ct, principal, primaryRows, secondaryRows, materials: materialRows, products: productRows, revenue, cost, profit, adjustments, reconciliation: profit + sum(adjustments.map(row => row.value)) };
  }
  root.CAE = { calculate, stages, methods };
})(globalThis);

