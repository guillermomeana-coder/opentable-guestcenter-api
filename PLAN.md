# OpenTable GuestCenter — Plan de Automatización Kitchen SJC

## Contexto
- Restaurant: Kitchen San José del Cabo (RID 1264498)
- Plan OT: Pro ($499/mo + $1/cover)
- Bot: Telegram NLP (Claude Haiku) para gestión via chat
- Tool: reverse-api-engineer para mapeo de endpoints

## Uso actual vs lo que necesitamos

### FASE 1 — Operación diaria (PRIORITARIO)
Lo que Guillermo hace cada día y necesita automatizado:

| Operación | Status API | Prioridad | RAE Target |
|-----------|-----------|-----------|------------|
| Crear reserva (guest existente) | ✅ Funciona | - | - |
| Crear reserva (guest NUEVO) | ❌ No funciona | **P0** | Capturar flow "Añadir a base de datos" |
| Cancelar reserva | ✅ Funciona | - | - |
| Modificar reserva (hora/pax/nota) | ✅ Funciona | - | - |
| Asignar concierge/referrer | ✅ Funciona | - | - |
| Listar reservas del día | ✅ Funciona | - | - |
| Buscar guest | ✅ Funciona | - | - |
| Ver perfil guest (visitas, notas) | ✅ Funciona | - | - |
| Asignar mesa | ❌ Formato desconocido | **P1** | Capturar flow asignar mesa en UI |
| Asignar staff/server | ⚠️ No probado | **P1** | Capturar flow asignar staff |
| Marcar arrived/seated | ❌ 500 (solo día servicio?) | **P2** | Capturar día de servicio real |
| Marcar no-show | ✅ Funciona | - | - |
| Confirmar estado reserva | ✅ Funciona | - | - |
| Cobrar/waivear depósito | ⚠️ Waive OK, cobrar no probado | **P1** | Capturar "Enviar enlace de pago" |
| Ver disponibilidad | ✅ Funciona | - | - |
| Vista semanal | ✅ Funciona (bot v3) | - | - |

### FASE 2 — Comunicación con guests
| Operación | Status | Prioridad | RAE Target |
|-----------|--------|-----------|------------|
| Responder reviews OT | ❌ Endpoint desconocido | **P1** | Capturar flow responder review |
| Responder reviews Google (via RT) | ❌ Solo URL directa | **P2** | Investigar ReviewTrackers API |
| Enviar mensaje a guest (inbox) | ❌ Solo lectura | **P2** | Capturar flow enviar mensaje |
| Enviar confirmación SMS/email | ❌ No probado | **P2** | Capturar toggle SMS/email en reserva |

### FASE 3 — Configuración y operación avanzada
| Operación | Status | Prioridad | RAE Target |
|-----------|--------|-----------|------------|
| Modificar mesas (capacity, tipo) | ❌ Solo lectura | **P2** | Capturar edición en Inventory |
| Modificar shifts/horarios | ❌ Solo lectura | **P3** | Capturar en Inventory |
| Publicar cambios disponibilidad | ❌ Solo lectura | **P2** | Capturar botón Publicar |
| Gestionar campañas marketing | ❌ Solo lectura | **P3** | Capturar creación campaña |
| Gestionar tags de guests | ❌ Solo lectura | **P3** | Capturar asignar tag |
| Cerrar/abrir días especiales | ❌ Solo lectura | **P3** | Capturar override calendar |

### FASE 4 — Analytics y reporting
| Operación | Status | Prioridad |
|-----------|--------|-----------|
| Cover trends | ✅ Lectura OK | - |
| Server performance | ✅ Lectura OK | - |
| Reviews summary | ✅ Lectura OK | - |
| Marketing insights | ✅ Lectura OK | - |
| Benchmarking | ✅ Lectura OK | - |

## Sesiones RAE planificadas

### Sesión 1 — Guest Creation (BLOCKER)
```bash
reverse-api-engineer agent -p "Log into OpenTable GuestCenter. Navigate to reservations for Nov 2 2026. Open the booking wizard. Search for a guest named 'Test Guest'. Click 'Add to database'. Fill in phone 5551234567 country US. Click Done. Capture ALL network requests during the guest creation flow. Then cancel the reservation." -u "https://guestcenter.opentable.com/restaurant/1264498/front-of-house/reservations/2026-11-02"
```

### Sesión 2 — Table + Staff + Deposit
```bash
reverse-api-engineer agent -p "In OpenTable GuestCenter reservations view, click on an existing reservation. Assign a table by dragging or clicking. Assign a staff member. Click 'Send payment link' to activate deposit. Capture all network requests for table assignment, staff assignment, and deposit activation." -u "https://guestcenter.opentable.com/restaurant/1264498/front-of-house/reservations/2026-11-02"
```

### Sesión 3 — Reviews + Messaging
```bash
reverse-api-engineer agent -p "Navigate to Reviews section. Click on a review and respond to it. Then go to Inbox and send a message to a guest. Capture all write endpoints." -u "https://guestcenter.opentable.com/restaurant/1264498/feedback/reviews"
```

### Sesión 4 — Inventory Configuration
```bash
reverse-api-engineer agent -p "Navigate to Inventory/Availability Planning. Edit a table's max party size. Edit shift hours. Publish changes. Capture all write endpoints." -u "https://guestcenter.opentable.com/restaurant/1264498/inventory"
```

## Bot Telegram — Features finales post-mapeo

### Comandos NLP (lenguaje natural en español)
- "reserva Juan 4 pax viernes 8pm" → crear (con guest nuevo si no existe)
- "cancela la de Katy" → cancelar con confirmación
- "mueve a Juan a las 9" → modificar hora
- "ponle mesa A a Juan" → asignar mesa
- "asigna Palmilla a la de Katy" → concierge
- "reservas de hoy" / "semana" → listar
- "busca Maria" / "perfil de Juan" → buscar
- "hay lugar viernes 8pm para 6?" → disponibilidad
- "reviews" → resumen + últimas
- "responde a la review de John: gracias..." → responder
- "mensajes" → inbox
- "cobrale depósito a Mariel" → activar pago

### Notificaciones automáticas
- 4pm: resumen del día
- 12am: cierre del día
- Nueva reserva online → notif inmediata
- Review nueva → notif + sugerencia de respuesta
- Cancelación → notif
- No-show → notif

### Dashboard diario (Telegram)
```
📋 Kitchen — Vie 7 Nov 2026

📊 12 reservas | 47 pax | ✅8 confirmadas | 🔵4 pendientes
⭐ 4.87 (237 reviews) | 🆕 1 review hoy

19:00 ✅ Juan Perez    4pax 🪑A  🏨Palmilla
19:00 🔵 Katy Morris   2pax 🪑B1
19:30 ✅ Bill Chevalier 3pax 🪑E
20:00 ✅ Mariel Lopez  17pax 🪑7  🏨Guille
...
```

## Timeline
- **Mañana**: Sesión RAE 1 (guest creation) + Kayla + depósitos Mariel
- **Día 2**: Sesiones RAE 2-3 (table/staff/deposit/reviews)
- **Día 3**: Sesión RAE 4 (inventory) + integrar todo al bot
- **Día 4**: Bot v4 con todas las features, testing completo
- **Día 5**: Deploy bot 24/7, documentación
