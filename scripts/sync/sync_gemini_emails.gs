/**
 * Google Apps Script para sincronizar Notas de Gemini con Blackwell Semaforo.
 *
 * Ya configurado y activo en producción:
 *   - URL: https://sem-foro-eta.vercel.app
 *   - Trigger: cada 15 minutos
 *   - Fuente: gemini-notes@google.com (Notas automáticas de Google Meet)
 *
 * Flujo:
 *   1. Busca correos no leídos de gemini-notes@google.com con subject "Notas:"
 *   2. Envía el cuerpo completo al endpoint /api/import-gemini-email en Vercel
 *   3. Vercel extrae tareas, las vincula a la cuenta correcta y las guarda en Supabase wa_tasks
 *   4. Marca el correo como leído + añade etiqueta "Semaforo-Sync"
 */

const DASHBOARD_URL = "https://sem-foro-eta.vercel.app";

function syncGeminiEmails() {
  const searchQuery = 'from:gemini-notes@google.com subject:"Notas:" is:unread';
  const threads = GmailApp.search(searchQuery, 0, 10);

  if (threads.length === 0) {
    Logger.log("No se encontraron correos nuevos de Gemini Notes.");
    return;
  }

  Logger.log("Se encontraron " + threads.length + " hilos de correo nuevos.");

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var messages = thread.getMessages();

    for (var j = 0; j < messages.length; j++) {
      var message = messages[j];

      if (message.isUnread()) {
        var subject = message.getSubject();
        var plainBody = message.getPlainBody();
        var htmlBody = message.getBody();

        Logger.log("Procesando correo: " + subject);

        try {
          var payload = {
            source: "gemini_notes_email",
            subject: subject,
            plainBody: plainBody,
            htmlBody: htmlBody,
            from: message.getFrom(),
            to: message.getTo(),
            cc: message.getCc(),
            bcc: message.getBcc(),
            replyTo: message.getReplyTo(),
            date: message.getDate().toISOString(),
            messageId: message.getId(),
            threadId: thread.getId(),
            attachments: message.getAttachments().map(function(file) {
              return {
                name: file.getName(),
                contentType: file.getContentType(),
                size: file.getBytes().length
              };
            })
          };

          var options = {
            method: "post",
            contentType: "application/json",
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
          };

          var response = UrlFetchApp.fetch(DASHBOARD_URL + "/api/import-gemini-email", options);
          var responseText = response.getContentText();
          var statusCode = response.getResponseCode();

          if (statusCode === 200) {
            Logger.log("Sincronización exitosa para: " + subject + ". Respuesta: " + responseText);
            message.markRead();
            getOrCreateLabel("Semaforo-Sync").addToThread(thread);
          } else {
            Logger.log("Error al enviar el correo a Vercel. Status: " + statusCode + ", Respuesta: " + responseText);
          }
        } catch (error) {
          Logger.log("Excepción al procesar correo: " + error.toString());
        }
      }
    }
  }
}

/**
 * Función auxiliar para obtener o crear una etiqueta de Gmail.
 */
function getOrCreateLabel(name) {
  var label = GmailApp.getUserLabelByName(name);
  if (!label) {
    label = GmailApp.createLabel(name);
  }
  return label;
}

/**
 * Función manual para re-procesar correos antiguos que fallaron.
 * Buscará los últimos 30 correos de notas y los enviará a Vercel.
 * Si ya fueron analizados correctamente, se saltarán (evitando duplicar).
 * Si estaban en modo fallback regex, ahora se procesarán con la IA.
 */
function reprocessHistoricalEmails() {
  const searchQuery = 'from:gemini-notes@google.com subject:"Notas:"';
  const threads = GmailApp.search(searchQuery, 0, 30);

  Logger.log("Reprocesando " + threads.length + " hilos de correo históricos.");

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var messages = thread.getMessages();

    for (var j = 0; j < messages.length; j++) {
      var message = messages[j];
      var subject = message.getSubject();
      var plainBody = message.getPlainBody();
      var htmlBody = message.getBody();

      Logger.log("Re-enviando correo: " + subject);

      try {
        var payload = {
          source: "gemini_notes_email",
          subject: subject,
          plainBody: plainBody,
          htmlBody: htmlBody,
          from: message.getFrom(),
          to: message.getTo(),
          cc: message.getCc(),
          bcc: message.getBcc(),
          replyTo: message.getReplyTo(),
          date: message.getDate().toISOString(),
          messageId: message.getId(),
          threadId: thread.getId(),
          attachments: []
        };

        var options = {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        };

        var response = UrlFetchApp.fetch(DASHBOARD_URL + "/api/import-gemini-email", options);
        Logger.log("Resultado para " + subject + ": " + response.getContentText());
      } catch (error) {
        Logger.log("Error al re-procesar: " + error.toString());
      }
    }
  }
}
