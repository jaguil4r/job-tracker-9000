(function () {
  'use strict';

  var API = '/api/applications';
  var ORDER = { Offer: 0, Interviewing: 1, Screening: 2, Applied: 3, Interested: 4, Rejected: 5, Withdrawn: 6 };
  var CLOSED = ['Rejected', 'Withdrawn'];
  var state = { items: [], statuses: [], filter: 'All', query: '', editing: null };

  var $ = function (id) { return document.getElementById(id); };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function daysSince(date) {
    return Math.round((new Date(today() + 'T00:00') - new Date(date + 'T00:00')) / 86400000);
  }

  function shortDate(date) {
    return new Date(date + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function toast(message) {
    var node = $('toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { node.hidden = true; }, 3000);
  }

  async function request(url, options) {
    var response = await fetch(url, options);
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(body.error || 'Something went wrong');
    return body;
  }

  function send(url, method, value) {
    return request(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    });
  }

  async function refresh() {
    var data = await request(API);
    state.items = data.applications;
    state.statuses = data.statuses;
    render();
  }

  function isDue(item) {
    return item.next_date && item.next_date <= today() && CLOSED.indexOf(item.status) === -1;
  }

  function visible() {
    var query = state.query.toLowerCase();
    return state.items
      .filter(function (item) {
        if (state.filter !== 'All' && item.status !== state.filter) return false;
        if (!query) return true;
        return [item.company, item.role, item.location, item.notes, item.contact, item.next_step]
          .join(' ').toLowerCase().indexOf(query) !== -1;
      })
      .sort(function (a, b) {
        return (ORDER[a.status] - ORDER[b.status]) || (b.applied || '').localeCompare(a.applied || '') || a.company.localeCompare(b.company);
      });
  }

  function renderSummary() {
    var count = function (names) {
      return state.items.filter(function (item) { return names.indexOf(item.status) !== -1; }).length;
    };
    var due = state.items.filter(isDue).length;
    $('t-active').textContent = count(['Applied']);
    $('t-talking').textContent = count(['Screening', 'Interviewing', 'Offer']);
    $('t-todo').textContent = count(['Interested']);
    $('t-due').textContent = due;
    $('t-due').parentElement.classList.toggle('has-due', due > 0);
    var sent = state.items.filter(function (item) { return item.status !== 'Interested'; }).length;
    $('summary').textContent = sent + (sent === 1 ? ' application' : ' applications') + ' sent, ' + state.items.length + ' jobs tracked';
  }

  function renderFilters() {
    var box = $('filters');
    box.replaceChildren();
    ['All'].concat(state.statuses).forEach(function (name) {
      var total = name === 'All' ? state.items.length : state.items.filter(function (i) { return i.status === name; }).length;
      if (name !== 'All' && total === 0) return;
      var button = el('button', 'filter', name);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(state.filter === name));
      button.append(el('span', '', String(total)));
      button.addEventListener('click', function () {
        state.filter = name;
        render();
      });
      box.append(button);
    });
  }

  function renderNext() {
    var steps = state.items
      .filter(function (item) { return item.next_step && CLOSED.indexOf(item.status) === -1 && item.status !== 'Interested'; })
      .sort(function (a, b) { return (a.next_date || '9999').localeCompare(b.next_date || '9999'); });
    var undated = steps.filter(function (s) { return !s.next_date; });
    var dated = steps.filter(function (s) { return s.next_date; });
    var ordered = undated.concat(dated).slice(0, 6);
    $('next-wrap').hidden = ordered.length === 0;
    var list = $('next');
    list.replaceChildren();
    ordered.forEach(function (item) {
      var li = el('li');
      li.append(el('strong', '', item.company));
      li.append(el('span', '', item.next_step));
      if (item.next_date) {
        var time = el('time', isDue(item) ? 'late' : '', shortDate(item.next_date));
        time.dateTime = item.next_date;
        li.append(time);
      }
      list.append(li);
    });
  }

  function cell(className, label, value, extra) {
    var box = el('div', className);
    box.append(el('div', 'col-label', label));
    box.append(el('div', 'col-value' + (extra ? ' ' + extra : ''), value));
    return box;
  }

  function renderRow(item) {
    var row = el('article', 'row' + (CLOSED.indexOf(item.status) !== -1 ? ' closed' : ''));

    var main = el('div', 'cell-main');
    var company = el('div', 'co');
    if (item.url) {
      var link = el('a', '', item.company);
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      company.append(link);
    } else {
      company.textContent = item.company;
    }
    main.append(company, el('div', 'role', item.role));
    var meta = [item.location, item.pay].filter(Boolean).join(' · ');
    if (meta) main.append(el('div', 'meta', meta));

    var statusBox = el('div', 'cell-status');
    var select = el('select', 'status');
    select.setAttribute('aria-label', 'Status for ' + item.company);
    select.dataset.status = item.status;
    state.statuses.forEach(function (name) {
      var option = el('option', '', name);
      option.value = name;
      option.selected = name === item.status;
      select.append(option);
    });
    select.addEventListener('change', function () { changeStatus(item, select.value); });
    statusBox.append(select);

    var appliedText = '—';
    if (item.applied) {
      var days = daysSince(item.applied);
      appliedText = shortDate(item.applied) + (days > 0 ? ' · ' + days + 'd ago' : ' · today');
    }

    var nextText = item.next_step || '—';
    if (item.next_step && item.next_date) nextText += ' (' + shortDate(item.next_date) + ')';

    var edit = el('button', 'edit', 'Edit');
    edit.type = 'button';
    edit.setAttribute('aria-label', 'Edit ' + item.company);
    edit.addEventListener('click', function () { openDialog(item); });
    var editBox = el('div', 'cell-edit');
    editBox.append(edit);

    row.append(main, statusBox, cell('cell-applied', 'Applied', appliedText), cell('cell-next', 'Next step', nextText, isDue(item) ? 'late' : ''), editBox);
    return row;
  }

  function render() {
    renderSummary();
    renderFilters();
    renderNext();
    var items = visible();
    $('list').replaceChildren.apply($('list'), items.map(renderRow));
    $('empty').hidden = items.length > 0;
  }

  async function changeStatus(item, status) {
    var updated = Object.assign({}, item, { status: status });
    if (status !== 'Interested' && !updated.applied) updated.applied = today();
    try {
      await send(API + '/' + item.id, 'PUT', updated);
      await refresh();
      toast(item.company + ' moved to ' + status);
    } catch (error) {
      toast(error.message);
      await refresh();
    }
  }

  function openDialog(item) {
    state.editing = item || null;
    var form = $('form');
    form.reset();
    $('form-error').textContent = '';
    $('dialog-title').textContent = item ? 'Edit ' + item.company : 'Add a job';
    $('delete').hidden = !item;
    $('delete').textContent = 'Delete';
    $('delete').dataset.armed = '';
    var values = item || { status: 'Interested' };
    Array.prototype.forEach.call(form.elements, function (field) {
      if (field.name) field.value = values[field.name] || '';
    });
    $('dialog').showModal();
  }

  function closeDialog() {
    $('dialog').close();
  }

  async function submitForm(event) {
    event.preventDefault();
    var form = $('form');
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    var value = {};
    Array.prototype.forEach.call(form.elements, function (field) {
      if (field.name) value[field.name] = field.value;
    });
    if (value.status !== 'Interested' && !value.applied) value.applied = today();
    try {
      if (state.editing) await send(API + '/' + state.editing.id, 'PUT', value);
      else await send(API, 'POST', value);
      closeDialog();
      await refresh();
      toast('Saved');
    } catch (error) {
      $('form-error').textContent = error.message;
    }
  }

  async function deleteItem() {
    var button = $('delete');
    if (!button.dataset.armed) {
      button.dataset.armed = 'yes';
      button.textContent = 'Click again to delete';
      return;
    }
    try {
      await request(API + '/' + state.editing.id, { method: 'DELETE' });
      closeDialog();
      await refresh();
      toast('Deleted');
    } catch (error) {
      $('form-error').textContent = error.message;
    }
  }

  $('add').addEventListener('click', function () { openDialog(null); });
  $('close').addEventListener('click', closeDialog);
  $('cancel').addEventListener('click', closeDialog);
  $('delete').addEventListener('click', deleteItem);
  $('form').addEventListener('submit', submitForm);
  $('search').addEventListener('input', function (event) {
    state.query = event.target.value;
    render();
  });

  request(API).then(function (data) {
    state.items = data.applications;
    state.statuses = data.statuses;
    state.statuses.forEach(function (name) {
      var option = el('option', '', name);
      option.value = name;
      $('status-select').append(option);
    });
    render();
  }).catch(function () {
    $('summary').textContent = 'Could not load your data. Is tracker.py running?';
  });
})();
