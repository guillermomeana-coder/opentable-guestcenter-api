# OpenTable GuestCenter API Client

Cliente Python para la API de OpenTable GuestCenter, generado mediante reverse engineering del HAR `recording.har` (24 Oct 2026).

**Restaurant ID:** `1264498`  
**Usuario:** `guillermomeana@ulp.edu.ar`  
**Staff ID:** `698796db4c736d653554fa2b`

---

## Uso rápido

```bash
pip install requests
python api_client.py
```

El script ejecuta 6 llamadas de verificación y demuestra que la sesión está activa.

---

## Autenticación

### Mecanismo
La API usa **cookies de sesión** gestionadas por un flujo **OAuth 2.0 PKCE** con Okta (`restauth.opentable.com`).

### Cookies principales
| Cookie | Descripción |
|--------|-------------|
| `otumamiauth` | Token de sesión principal (hexadecimal largo) |
| `otumamiuser` | Email del usuario autenticado |
| `OT-SessionId` | ID de sesión de OpenTable |
| `otclientid` | ID de cliente de OpenTable |

### Re-autenticación automática
Cuando las cookies expiran (respuestas 401/403), el cliente las renueva automáticamente:

1. `POST https://restauth.opentable.com/oauth2/default/v1/token`  
   - `grant_type=refresh_token`  
   - `refresh_token=3DFEZUjEaEOjos4_jFtQ_KY05XGMcHSbYU6IvkeZcAk`  
   - `client_id=0oabit60qvY1wTxAv5d6`

2. `POST https://guestcenter.opentable.com/gc-cookie-exchange`  
   - Body: `{"token": "<access_token>"}`  
   - Las cookies de sesión se actualizan automáticamente desde la respuesta.

> **Nota:** El `refresh_token` también rota con cada uso. Si el script lo usa, el nuevo valor aparece en los logs para que lo actualices en `OAUTH_REFRESH_TOKEN`.

---

## API Endpoints implementados

### Configuración del restaurante

| Método | Endpoint | Función |
|--------|----------|---------|
| `GET` | `/gateway/proxies/client-aggregator/web/api/restaurants/{rid}/configuration` | `get_restaurant_config()` |
| `GET` | `/gateway/proxies/client-aggregator/web/api/restaurants/{rid}/configuration/entitlements` | `get_restaurant_entitlements()` |
| `GET` | `/gateway/proxies/gcrestaurant/api/userContext` | `get_user_context()` |
| `GET` | `/gateway/proxies/gcPermissionsAggregator/api/v2/contexts/.../permissions` | `get_user_permissions()` |
| `GET` | `/gateway/proxies/featureManager/v3/api/restaurant/{rid}/toggles` | `get_feature_toggles()` |
| `GET` | `/gateway/proxies/gcnavigation/api/v1/restaurant/{rid}` | `get_navigation()` |
| `GET` | `/gateway/proxies/gcrestaurant/api/restaurants/{rid}` | `get_restaurant_info()` |

### Sincronización

| Método | Endpoint | Función |
|--------|----------|---------|
| `GET` | `/gateway/proxies/gcFohWeb/api/{rid}/initial-sync` | `get_initial_sync()` |
| `GET` | `/gateway/proxies/gcFohWeb/api/{rid}/latest-sequence-ids` | `get_latest_sequence_ids()` |
| `POST` | `/gateway/proxies/gcFohWeb/api/{rid}/bulk-sync?entities=Reservations,CoverBlocks,TableBlocks` | `bulk_sync_reservations(date)` |
| `POST` | `/gateway/proxies/gcFohWeb/api/{rid}/bulk-sync?entities=ReservationWaitlistParties,Notes` | `bulk_sync_waitlist_notes(date)` |
| `POST` | `/gateway/proxies/client-sync/web/api/v1/sync/restaurant/{rid}/entities` | `sync_entities(...)` |
| `POST` | `/gateway/proxies/client-aggregator/web/api/restaurants/{rid}/schedule/days` | `get_schedule_days(date)` |

### Reservaciones

| Método | Endpoint | Función |
|--------|----------|---------|
| `POST` | `/gateway/proxies/foh-web/gcFohWeb/api/{rid}/v2/reservations?disableVault=true` | `create_reservation(...)` |
| `PUT` | `/gateway/proxies/foh-web/gcFohWeb/api/{rid}/v2/reservations/{id}` | `update_reservation(...)` |
| `PUT` | idem | `confirm_reservation(id)` |
| `PUT` | idem | `cancel_reservation(id)` |
| `PUT` | idem | `seat_reservation(id)` |
| `PUT` | idem | `finish_reservation(id)` |
| `PUT` | idem | `update_reservation_notes(id, notes)` |
| `PUT` | idem | `update_reservation_deposit(id, amount)` |
| `PUT` | idem | `assign_staff_to_reservation(id, staff_id, name)` |
| `GET` | `/gateway/proxies/foh-web/gcFohWeb/api/{rid}/reservation/{resId}/guest/{guestId}/visit-spend` | `get_visit_spend(res_id, guest_id)` |

### Huéspedes

| Método | Endpoint | Función |
|--------|----------|---------|
| `GET` | `/gateway/proxies/gcFohWeb/api/{rid}/v4/guests/search?query={q}` | `search_guests(query)` |
| `GET` | `/gateway/proxies/crm/guestProfile/api/v1/modular-guest-profile/restaurants/{rid}/guests/{id}` | `get_guest_profile(guest_id)` |
| `GET` | `/gateway/proxies/fohAggregator/restaurant/{rid}/guest/{id}/groupProfile` | `get_guest_group_profile(guest_id)` |
| `POST` | `/gateway/proxies/foh-web/gcFohWeb/api/{rid}/v1/guests/profiles/bulk` | `get_bulk_guest_profiles([ids])` |
| `POST` | `/gateway/proxies/foh-web/aggregator/v2/restaurant/{rid}/dinerprofile` | `get_diner_profiles([gpids])` |

### Venue / Políticas

| Método | Endpoint | Función |
|--------|----------|---------|
| `GET` | `/gateway/proxies/gcVenue/umami_venue/api/v4/Restaurant/{rid}/OrphanedReservation` | `get_orphaned_reservations(date)` |
| `GET` | `/gateway/proxies/foh-web/restaurantPolicies/v1/{rid}/booking-policy-summaries` | `get_booking_policy_summaries()` |
| `GET` | `/gateway/proxies/referralManagement/user/v1/restaurants/{rid}/referrers` | `get_referrers()` |

### Inbox / Mensajería

| Método | Endpoint | Función |
|--------|----------|---------|
| `GET` | `/gateway/proxies/gc-inbox/gcDmService/v2/restaurants/{rid}/context` | `get_inbox_context()` |
| `GET` | `/gateway/proxies/gc-inbox/gcDmService/v2/restaurants/{rid}/conversation/info` | `get_inbox_conversations()` |
| `GET` | `/gateway/proxies/gc-inbox/gcDmService/v2/restaurants/{rid}/conversation/confirmation/{num}` | `get_conversation_by_confirmation(num)` |

---

## Crear una reservación

```python
from api_client import OpenTableGuestCenterClient
import uuid

client = OpenTableGuestCenterClient()

# Buscar el huésped primero
guests = client.search_guests("Kayla Dillard")
guest_id = guests["results"][0]["guest_id"]

# Crear la reservación
result = client.create_reservation(
    guest_id=guest_id,
    party_size=4,
    scheduled_utc="2026-12-15T21:00:00Z",   # UTC
    scheduled_local="2026-12-15T15:00:00",   # Hora local del restaurante
    restaurant_day="2026-12-15",
    dining_area_id=103677,
    origin="PHONE",                           # PHONE | WALK_IN | ONLINE
    deposit_amount=120000,                    # $1,200.00 MXN (en centavos)
    deposit_currency="MXN",
)
reservation_id = result["ReservationId"]
print(f"Reservacion creada: {reservation_id}")
```

---

## Modificar una reservación

```python
# Confirmar
client.confirm_reservation(reservation_id)

# Cambiar notas
client.update_reservation_notes(
    reservation_id,
    "Mesa EXTERIOR, NO barra. Tel: +1 555-123-4567"
)

# Actualizar deposito
client.update_reservation_deposit(
    reservation_id,
    amount=510000,   # $5,100.00 MXN
    currency="MXN",
    status="PendingDinerPayment",
)

# Asignar servidor
client.assign_staff_to_reservation(
    reservation_id,
    staff_id="698796db4c736d653554fa2b",
    server_name="Guillermo von Papendieck",
)

# Sentar comensales
client.seat_reservation(reservation_id)

# Cancelar
client.cancel_reservation(reservation_id)
```

---

## Campos de body encontrados en el HAR

### POST crear reservación (campos completos)
```json
{
  "RID": 1264498,
  "State": "NotConfirmed",
  "Origin": "PHONE",
  "ReservationId": "<uuid>",
  "PartySize": 4,
  "Scheduled": "2026-11-03T02:00:00Z",
  "ScheduledLocal": "2026-11-02T19:00:00",
  "$restaurantDay": "2026-11-02",
  "GuestId": "<uuid>",
  "DiningAreaId": 103677,
  "ExperienceId": 0,
  "DiningArea": {"Selection": "specific", "Id": 103677},
  "SlotLockId": null,
  "SMSOptIn": true,
  "EmailConfirmationOptOut": false,
  "OverbookingReason": "None",
  "CancellationPolicyId": "64b846257896686eaddea365:v12",
  "DepositDetails": {
    "TotalPrice": 120000,
    "Currency": "MXN",
    "CurrencyDenominator": 100,
    "Status": "PendingDinerPayment"
  },
  "BookingContext": {
    "NoTablesAvailable": false,
    "AllowedBookingChannelViolations": [],
    "AllowAccessRuleViolation": false
  },
  "CommandParameters": {
    "ModifiedBy": "698796db4c736d653554fa2b",
    "ClientInfo": {"Client": "Web App", "ClientVersion": "gc-microapp-front-of-house-Base-10144"}
  },
  "Tags": [],
  "$allTags": []
}
```

### PUT modificar estado
```json
{
  "reservation": {
    "State": "Confirmed",
    "ReservationId": "<uuid>",
    "CommandParameters": {"ModifiedBy": "698796db4c736d653554fa2b"}
  }
}
```

### PUT actualizar depósito
```json
{
  "reservation": {
    "DepositDetails": {
      "TotalPrice": 510000,
      "Currency": "MXN",
      "CurrencyDenominator": 100,
      "Status": "PendingDinerPayment"
    },
    "CancellationPolicyWaivedReason": null,
    "ReservationId": "<uuid>",
    "CommandParameters": {"ModifiedBy": "698796db4c736d653554fa2b"}
  }
}
```

### PUT actualizar notas y staff
```json
{
  "reservation": {
    "VenueNotes": "Mesa EXTERIOR, NO barra. Tel: +1 805-444-7428",
    "StaffId": "698796db4c736d653554fa2b",
    "Server": "Guillermo von Papendieck",
    "ReservationId": "<uuid>",
    "CommandParameters": {"ModifiedBy": "698796db4c736d653554fa2b"}
  }
}
```

---

## Estados de reservación

| Estado | Descripcion |
|--------|-------------|
| `NotConfirmed` | Pendiente de confirmar |
| `Confirmed` | Confirmada |
| `Seated` | Comensales sentados |
| `Finished` | Servicio terminado |
| `Canceled` | Cancelada |
| `NoShow` | No se presentaron |

---

## Limitaciones

1. **Caducidad de sesión:** Las cookies del HAR expiran. El cliente intenta renovarlas automáticamente via refresh_token, pero si el refresh_token también expira (raramente), se necesita hacer login manual o usar Playwright para obtener nuevas cookies.

2. **hCaptcha:** El login inicial requiere resolver un captcha. No está automatizado. Para obtener nuevas cookies desde cero, se necesita un browser real.

3. **Bot detection (Akamai):** Las cookies `ak_bmsc`, `bm_sc`, `bm_so` son generadas por Akamai Bot Manager. Si el servidor las invalida agresivamente, puede rechazar requests aunque el refresh_token sea válido.

4. **Tokens OAuth en el HAR:** Los tokens del HAR ya no son válidos (access_token duró 6 horas desde la grabación), pero el refresh_token puede seguir siendo válido si no fue revocado.

---

## Archivos

| Archivo | Descripcion |
|---------|-------------|
| `api_client.py` | Cliente Python completo con autenticacion y todos los endpoints |
| `README.md` | Esta documentacion |

---

*Generado por reverse engineering de `recording.har` - OpenTable GuestCenter - 24 Oct 2026*
