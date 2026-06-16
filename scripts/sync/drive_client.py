"""
drive_client.py — Cliente autenticado de Google Drive API v3.

Soporta dos métodos de autenticación:
  1. OAuth2 interactivo (para desarrollo local con cuenta personal)
  2. Service Account (para automatización en servidor)

La elección se hace automáticamente:
  - Si GOOGLE_SERVICE_ACCOUNT_JSON está en .env → service account
  - Si credentials.json existe → OAuth2 (abre browser la primera vez)
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2 import service_account
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from config import (
    DRIVE_SCOPES,
    GOOGLE_CREDENTIALS_PATH,
    GOOGLE_SERVICE_ACCOUNT_JSON,
    GOOGLE_TOKEN_PATH,
)

logger = logging.getLogger(__name__)


def get_drive_service():
    """
    Devuelve un objeto de servicio autenticado de Google Drive API v3.
    Lanza RuntimeError si no hay credenciales configuradas.
    """
    creds = _load_credentials()
    service = build("drive", "v3", credentials=creds, cache_discovery=False)
    logger.info("Cliente Drive API listo")
    return service


def _load_credentials() -> Credentials:
    # ── Opción 1: Service Account ──────────────────────────────────────────
    if GOOGLE_SERVICE_ACCOUNT_JSON and os.path.exists(GOOGLE_SERVICE_ACCOUNT_JSON):
        logger.info("Autenticando con service account: %s", GOOGLE_SERVICE_ACCOUNT_JSON)
        return service_account.Credentials.from_service_account_file(
            GOOGLE_SERVICE_ACCOUNT_JSON, scopes=DRIVE_SCOPES
        )

    # ── Opción 2: OAuth2 ───────────────────────────────────────────────────
    creds: Credentials | None = None

    if os.path.exists(GOOGLE_TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(GOOGLE_TOKEN_PATH, DRIVE_SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            logger.info("Refrescando token OAuth2...")
            creds.refresh(Request())
        else:
            if not os.path.exists(GOOGLE_CREDENTIALS_PATH):
                raise RuntimeError(
                    f"No se encontraron credenciales. "
                    f"Configura GOOGLE_SERVICE_ACCOUNT_JSON en .env "
                    f"o descarga credentials.json desde Google Cloud Console "
                    f"y colócalo en: {GOOGLE_CREDENTIALS_PATH}"
                )
            logger.info("Iniciando flujo OAuth2 (se abrirá el navegador)...")
            flow = InstalledAppFlow.from_client_secrets_file(
                GOOGLE_CREDENTIALS_PATH, DRIVE_SCOPES
            )
            creds = flow.run_local_server(port=0)

        with open(GOOGLE_TOKEN_PATH, "w") as f:
            f.write(creds.to_json())
        logger.info("Token OAuth2 guardado en %s", GOOGLE_TOKEN_PATH)

    return creds


def execute_with_retry(request, max_attempts: int = 6):
    """
    Ejecuta un request de Drive API con reintentos ante errores de red
    transitorios (ConnectionResetError, DNS caído, timeouts, 5xx).

    googleapiclient ya reintenta 5xx/timeouts con num_retries, pero algunos
    errores de socket en Windows (WinError 10054) se escapan — aquí los
    atrapamos con backoff exponencial propio.
    """
    import time

    delay = 2.0
    for attempt in range(1, max_attempts + 1):
        try:
            return request.execute(num_retries=3)
        except HttpError:
            raise  # errores de API reales (404, 403...) no se reintentan aquí
        except Exception as e:
            if attempt == max_attempts:
                raise
            logger.warning(
                "Error de red transitorio (%s: %s). Reintento %d/%d en %.0fs...",
                type(e).__name__, e, attempt, max_attempts - 1, delay,
            )
            time.sleep(delay)
            delay = min(delay * 2, 60)


def paginate(service_call, **kwargs) -> list[dict[str, Any]]:
    """
    Itera automáticamente todas las páginas de una llamada a Drive API.

    Uso:
        files = paginate(
            service.files().list,
            q="'folder_id' in parents",
            fields="files(id,name,modifiedTime,mimeType,createdTime,size)",
            pageSize=1000,
        )
    """
    results: list[dict] = []
    page_token: str | None = None

    while True:
        try:
            # num_retries reintenta con backoff exponencial errores transitorios
            # (5xx, timeouts, ConnectionResetError, DNS) — evita que un parpadeo
            # de red tire todo el sync.
            response = execute_with_retry(service_call(**kwargs, pageToken=page_token))
        except HttpError as e:
            logger.error("Drive API error: %s", e)
            raise

        items = response.get("files", [])
        results.extend(items)

        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return results
