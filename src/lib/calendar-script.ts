// This text is displayed in Settings for users to copy into their own Apps Script project.
export const calendarScript = `// Timelogger Google Calendar bridge
// Deploy as a Web app: Execute as "Me"; access "Anyone".
// Keep the resulting /exec URL private. It grants access to this calendar bridge.

function reply_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return reply_({ ok: true, service: 'Timelogger Calendar' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var request = JSON.parse(e.postData.contents || '{}');
    if (!/^[0-9a-f-]{36}$/i.test(request.entry_id || '')) throw new Error('Invalid entry ID');
    if (request.action !== 'upsert' && request.action !== 'delete') throw new Error('Invalid action');
    lock.waitLock(30000);
    var properties = PropertiesService.getScriptProperties();
    var key = 'timelogger:' + request.entry_id;
    var calendar = CalendarApp.getDefaultCalendar();
    var storedId = properties.getProperty(key);
    var eventId = storedId || request.event_id;
    var event = eventId ? calendar.getEventById(eventId) : null;

    if (request.action === 'delete') {
      if (event) event.deleteEvent();
      properties.deleteProperty(key);
      return reply_({ ok: true });
    }

    var entry = request.entry || {};
    var start = new Date(entry.start_at);
    var end = new Date(entry.end_at);
    if (!isFinite(start.getTime()) || !isFinite(end.getTime()) || end <= start) {
      throw new Error('Invalid event times');
    }
    var title = [entry.project, entry.task || entry.description || 'Time entry']
      .filter(Boolean).join(' — ');
    var description = [
      entry.description || '',
      entry.project ? 'Project: ' + entry.project : '',
      entry.task ? 'Task: ' + entry.task : '',
      'Timelogger entry: ' + request.entry_id
    ].filter(Boolean).join('\\n');

    if (!event) {
      event = calendar.getEvents(start, end).filter(function (item) {
        return item.getTag('timelogger_entry_id') === request.entry_id;
      })[0] || null;
    }
    if (event) {
      event.setTitle(title);
      event.setTime(start, end);
      event.setDescription(description);
    } else {
      event = calendar.createEvent(title, start, end, { description: description });
    }
    event.setTag('timelogger_entry_id', request.entry_id);
    properties.setProperty(key, event.getId());
    return reply_({ ok: true, event_id: event.getId() });
  } catch (error) {
    return reply_({ ok: false, error: String(error && error.message || error) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}
`;
