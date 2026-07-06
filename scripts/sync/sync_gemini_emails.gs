/**
 * Google Apps Script para sincronizar Notas de Gemini con Blackwell Semaforo.
 * 
 * INSTRUCCIONES DE USO:
 * 1. Abre https://script.google.com/
 * 2. Crea un proyecto nuevo.
 * 3. Copia y pega este código en el editor.
 * 4. Cambia la variable `DASHBOARD_URL` por la URL de tu despliegue de Vercel.
 * 5. Haz clic en el botón de "Guardar" y luego ejecuta la función `syncGeminiEmails` una vez para conceder permisos de lectura de Gmail y conexiones externas.
 * 6. En el menú izquierdo de Apps Script, ve a "Activadores" (icono de reloj).
 * 7. Crea un activador nuevo:
 *    - Función a ejecutar: `syncGeminiEmails`
 *    - Evento: Basado en el tiempo → Temporizador de minutos → Cada 15 minutos.
 */

// REEMPLAZA ESTO CON LA URL DE TU DESPLIEGUE EN VERCEL
const DASHBOARD_URL = "https://tu-dominio-de-vercel.vercel.app";

function syncGeminiEmails() {
  // Buscamos correos no leídos que provengan de gemini-notes@google.com
  const searchQuery = 'from:gemini-notes@google.com subject:"Notas:" is:unread';
  const threads = GmailApp.search(searchQuery, 0, 10); // Límite de 10 hilos por ejecución
  
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
      
      // Solo procesar si el mensaje individual no ha sido leído
      if (message.isUnread()) {
        var subject = message.getSubject();
        var body = message.getPlainBody(); // Obtenemos la versión de texto plano
        
        Logger.log("Procesando correo: " + subject);
        
        try {
          var payload = {
            subject: subject,
            body: body
          };
          
          var options = {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
          };
          
          // Enviamos el correo al endpoint de Vercel
          var response = UrlFetchApp.fetch(DASHBOARD_URL + "/api/import-gemini-email", options);
          var responseText = response.getContentText();
          var statusCode = response.getResponseCode();
          
          if (statusCode === 200) {
            Logger.log("Sincronización exitosa para: " + subject + ". Respuesta: " + responseText);
            // Marcamos como leído para no volver a procesarlo
            message.markRead();
            
            // Opcional: Agregar una etiqueta para organización visual en Gmail
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
