// Shown in Settings for users to copy into their own Apps Script project.
// Based on the user's existing Clockify webhook; its upsert contract remains valid.
export const calendarScript = `/**
 * Deploy as a web app, executing as you, with access set to Anyone.
 * Set script properties CALENDAR_ID and WEBHOOK_SECRET before deployment.
 * This version accepts Clockify upserts and Timelogger upserts/deletes.
 */
function doPost(e) {
  try {
    var input = JSON.parse(e.postData.contents);
    var properties = PropertiesService.getScriptProperties();
    if (!input.secret || input.secret !== properties.getProperty('WEBHOOK_SECRET')) {
      return json_({ ok: false, error: 'Unauthorized' });
    }
    if ((input.source !== 'clockify' && input.source !== 'timelogger') ||
        (input.action !== 'upsert' && input.action !== 'delete') ||
        !input.idempotencyKey) {
      return json_({ ok: false, error: 'Invalid request' });
    }
    if (input.action === 'upsert' &&
        (!input.event || !input.event.title || !input.event.start || !input.event.end)) {
      return json_({ ok: false, error: 'Invalid event' });
    }

    var calendar = CalendarApp.getCalendarById(properties.getProperty('CALENDAR_ID'));
    if (!calendar) return json_({ ok: false, error: 'Calendar not found' });

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var propertyKey = input.idempotencyKey;
      var existingId = properties.getProperty(propertyKey) || input.eventId;
      var event = existingId ? calendar.getEventById(existingId) : null;

      if (input.action === 'delete') {
        if (event) event.deleteEvent();
        properties.deleteProperty(propertyKey);
        return json_({ ok: true });
      }

      var start = new Date(input.event.start);
      var end = new Date(input.event.end);
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
        return json_({ ok: false, error: 'Invalid time range' });
      }
      if (event) {
        event.setTitle(input.event.title);
        event.setTime(start, end);
        event.setDescription(input.event.description || '');
      } else {
        event = calendar.createEvent(input.event.title, start, end, {
          description: input.event.description || ''
        });
      }
      properties.setProperty(propertyKey, event.getId());
      return json_({ ok: true, eventId: event.getId() });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return json_({ ok: false, error: String(error) });
  }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
`;
