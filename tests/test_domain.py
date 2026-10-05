"""Meaningful booking invariants using real SQLite transactions."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
import tempfile
import threading
import unittest

from mestia.db import connect, init_db
from mestia import domain as d


class BookingDomainTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary.name) / 'test.sqlite3'
        self.conn = connect(self.path)
        init_db(self.conn)
        self.start = d.timestamp(d.now() + timedelta(days=10))
        self.end = d.timestamp(d.now() + timedelta(days=11))
        self.expiry = d.timestamp(d.now() + timedelta(hours=2))
        self.room = self.resource('room', 'Only room', occupancy=2)
        self.guide = self.resource('guide', 'Guide')
        self.driver = self.resource('driver', 'Driver')
        self.vehicle = self.resource('vehicle', 'Vehicle', occupancy=4)

    def tearDown(self):
        self.conn.close()
        self.temporary.cleanup()

    def resource(self, kind, name, capacity=1, occupancy=None, buffer=0):
        return self.conn.execute('''INSERT INTO resources(provider_id,name,kind,capacity,passenger_capacity,approved,buffer_minutes)
                     VALUES(1,?,?,?,?,1,?)''', (name, kind, capacity, occupancy, buffer)).lastrowid

    def enquiry(self, kind='stay', **changes):
        data = dict(kind=kind, name='Test guest', email='guest@example.test', starts_at=self.start,
                    ends_at=self.end, party_size=2)
        data.update(changes)
        return d.create_enquiry(self.conn, data)

    def quote_data(self, kind='stay', resource=None, **changes):
        data = dict(items=[dict(kind=kind, title='Owner quoted service', quantity=1, unit_price_minor=15000)],
                    allocations=[dict(resource_id=resource or self.room)], expires_at=self.expiry,
                    terms='Test policy terms, version one.', policy_version='test-1', currency='GEL')
        data.update(changes)
        return data

    def accepted(self, kind='stay', resource=None, **changes):
        enquiry = self.enquiry(kind)
        quote = d.create_quote(self.conn, enquiry['id'], self.quote_data(kind, resource, **changes))
        d.verify_contact(self.conn, enquiry['id'], 'Two-way phone call confirmed requested dates')
        d.accept_quote(self.conn, quote['id'])
        return enquiry, d.get_quote(self.conn, quote['id'])

    def test_plain_contact_or_payment_never_confirms_and_pending_deposit_is_not_money(self):
        enquiry = self.enquiry()
        quote = d.create_quote(self.conn, enquiry['id'], self.quote_data(deposit_required_minor=5000))
        with self.assertRaises(d.DomainError):
            d.confirm_booking(self.conn, quote['id'])
        d.accept_quote(self.conn, quote['id'])
        with self.assertRaises(d.DomainError):
            d.confirm_booking(self.conn, quote['id'])
        d.verify_contact(self.conn, enquiry['id'], 'Guest replied in WhatsApp')
        payment = d.record_payment(self.conn, quote['id'], 5000, reference='Receipt awaiting bank settlement')
        self.assertEqual('pending_verification', d.get_quote(self.conn, quote['id'])['payment_status'])
        with self.assertRaises(d.DomainError):
            d.confirm_booking(self.conn, quote['id'])
        d.verify_payment(self.conn, payment['id'], 'Funds settled in business bank account')
        self.assertEqual(0, self.conn.execute('SELECT COUNT(*) FROM bookings').fetchone()[0])
        booking = d.confirm_booking(self.conn, quote['id'])
        self.assertEqual('confirmed', booking['status'])
        self.assertEqual(booking['id'], d.confirm_booking(self.conn, quote['id'])['id'])

    def test_expired_hold_releases_inventory_and_late_money_cannot_confirm(self):
        first, quote = self.accepted()
        self.conn.execute('UPDATE quotes SET expires_at=? WHERE id=?', (d.timestamp(d.now() - timedelta(seconds=1)), quote['id']))
        second = self.enquiry()
        replacement = d.create_quote(self.conn, second['id'], self.quote_data())
        self.assertEqual('expired', d.get_quote(self.conn, quote['id'])['status'])
        d.record_payment(self.conn, quote['id'], 15000, reference='Late actual settled funds', verified=True)
        with self.assertRaises(d.DomainError):
            d.confirm_booking(self.conn, quote['id'])
        self.assertEqual('offered', replacement['status'])

    def test_two_concurrent_requests_for_last_room_cannot_both_hold_or_confirm(self):
        first, second = self.enquiry(), self.enquiry()
        barrier = threading.Barrier(2)

        def contender(enquiry_id):
            conn = connect(self.path)
            try:
                barrier.wait(timeout=5)
                quote = d.create_quote(conn, enquiry_id, self.quote_data())
                d.verify_contact(conn, enquiry_id, 'Two-way conversation')
                d.accept_quote(conn, quote['id'])
                return d.confirm_booking(conn, quote['id'])['id']
            except d.DomainError:
                return None
            finally:
                conn.close()

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(contender, [first['id'], second['id']]))
        self.assertEqual(1, sum(result is not None for result in results))
        self.assertEqual(1, self.conn.execute("SELECT COUNT(*) FROM bookings WHERE status='confirmed'").fetchone()[0])

    def test_confirmation_rechecks_final_capacity_inside_write_transaction(self):
        # Simulate imported legacy quotes which bypassed normal hold checks.
        # Only one concurrent confirmation may consume the final room.
        first, quote1 = self.accepted()
        self.conn.execute('UPDATE quotes SET expires_at=? WHERE id=?', (d.timestamp(d.now() - timedelta(seconds=1)), quote1['id']))
        second, quote2 = self.accepted()
        self.conn.execute("UPDATE quotes SET status='accepted',expires_at=? WHERE id=?", (self.expiry, quote1['id']))
        barrier = threading.Barrier(2)

        def confirm(quote_id):
            conn = connect(self.path)
            try:
                barrier.wait(timeout=5)
                return d.confirm_booking(conn, quote_id)
            except d.DomainError:
                return None
            finally:
                conn.close()

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(confirm, [quote1['id'], quote2['id']]))
        # Both conflicting legacy holds require staff repair; neither can overbook.
        self.assertEqual(0, sum(result is not None for result in results))

    def test_price_and_terms_are_snapshots_and_revision_is_atomic(self):
        service_id = self.conn.execute("INSERT INTO services(provider_id,slug,kind,title_en,price_minor,published) VALUES(1,'room','stay','Room',10000,1)").lastrowid
        enquiry = self.enquiry(service_id=service_id)
        data = self.quote_data(items=[dict(service_id=service_id, title='Accepted room', quantity=2, unit_price_minor=10000)])
        quote = d.create_quote(self.conn, enquiry['id'], data)
        d.accept_quote(self.conn, quote['id'])
        self.conn.execute('UPDATE services SET price_minor=99000,title_en=? WHERE id=?', ('Renamed room', service_id))
        saved = d.get_quote(self.conn, quote['id'])
        self.assertEqual(20000, saved['total_minor'])
        self.assertEqual('Accepted room', saved['items'][0]['title'])
        self.assertEqual('test-1', saved['policy_version'])
        blocked_room = self.resource('room', 'Blocked room', occupancy=2)
        d.block_resource(self.conn, blocked_room, self.start, self.end, 'Repairs')
        with self.assertRaises(d.DomainError):
            d.replace_quote(self.conn, quote['id'], self.quote_data(resource=blocked_room))
        self.assertEqual('accepted', d.get_quote(self.conn, quote['id'])['status'])
        replacement = d.replace_quote(self.conn, quote['id'], self.quote_data())
        self.assertEqual(2, replacement['version'])
        self.assertEqual('offered', replacement['status'])
        self.assertEqual('superseded', d.get_quote(self.conn, quote['id'])['status'])

    def test_taxi_driver_guest_fare_acceptance_and_vehicle_fit(self):
        enquiry = self.enquiry('taxi')
        quote = d.create_quote(self.conn, enquiry['id'], self.quote_data('taxi', allocations=[]))
        d.verify_contact(self.conn, enquiry['id'], 'Guest confirmed pickup')
        with self.assertRaises(d.DomainError):
            d.assign_driver(self.conn, quote['id'], self.driver, self.vehicle)
        d.accept_quote(self.conn, quote['id'])
        with self.assertRaises(d.DomainError):
            d.confirm_booking(self.conn, quote['id'])
        with self.assertRaises(d.DomainError):
            d.assign_driver(self.conn, quote['id'], self.driver, self.vehicle, fare_minor=1)
        small_vehicle = self.resource('vehicle', 'One passenger vehicle', occupancy=1)
        with self.assertRaises(d.DomainError):
            d.assign_driver(self.conn, quote['id'], self.driver, small_vehicle)
        assignment = d.assign_driver(self.conn, quote['id'], self.driver, self.vehicle)
        with self.assertRaises(d.DomainError):
            d.confirm_booking(self.conn, quote['id'])
        d.accept_assignment(self.conn, assignment['id'], 'Driver accepted pickup, time, fare and luggage')
        booking = d.confirm_booking(self.conn, quote['id'])
        self.assertEqual('ready', booking['operational_status'])

    def test_reassignment_preserves_history_and_marks_attention_until_accepted(self):
        enquiry, quote = self.accepted('taxi', allocations=[])
        assignment = d.assign_driver(self.conn, quote['id'], self.driver, self.vehicle)
        d.accept_assignment(self.conn, assignment['id'], 'Driver accepted job')
        booking = d.confirm_booking(self.conn, quote['id'])
        driver2 = self.resource('driver', 'Replacement driver')
        vehicle2 = self.resource('vehicle', 'Replacement vehicle', occupancy=4)
        replacement = d.assign_driver(self.conn, quote['id'], driver2, vehicle2, note='First driver unavailable')
        self.assertEqual('cancelled', self.conn.execute('SELECT status FROM assignments WHERE id=?', (assignment['id'],)).fetchone()[0])
        self.assertEqual('needs_attention', d.get_quote(self.conn, quote['id'])['booking']['operational_status'])
        d.accept_assignment(self.conn, replacement['id'], 'Replacement accepted')
        self.assertEqual('ready', d.get_quote(self.conn, quote['id'])['booking']['operational_status'])
        d.mark_assignment(self.conn, replacement['id'], 'unavailable', 'Vehicle failure')
        self.assertEqual('needs_attention', d.get_quote(self.conn, quote['id'])['booking']['operational_status'])
        self.assertEqual('confirmed', d.get_quote(self.conn, quote['id'])['booking']['status'])

    def test_expired_driver_offer_releases_dispatch_resources(self):
        enquiry, quote = self.accepted('taxi', allocations=[])
        assignment = d.assign_driver(self.conn, quote['id'], self.driver, self.vehicle)
        self.conn.execute('UPDATE assignments SET expires_at=? WHERE id=?', (d.timestamp(d.now() - timedelta(seconds=1)), assignment['id']))
        d.expire_holds(self.conn)
        with self.assertRaises(d.DomainError):
            d.accept_assignment(self.conn, assignment['id'], 'Late response')
        self.assertEqual(0, self.conn.execute("SELECT COUNT(*) FROM allocations WHERE quote_id=? AND origin='dispatch'", (quote['id'],)).fetchone()[0])

    def test_shared_guide_conflicts_across_different_services_and_buffers(self):
        self.conn.execute('UPDATE resources SET buffer_minutes=30 WHERE id=?', (self.guide,))
        first, quote = self.accepted('tour', self.guide)
        second = self.enquiry('tour', starts_at=self.end, ends_at=d.timestamp(d._date(self.end) + timedelta(hours=2)))
        with self.assertRaises(d.DomainError):
            d.create_quote(self.conn, second['id'], self.quote_data('tour', self.guide))
        second_data = self.quote_data('tour', self.guide, allocations=[dict(resource_id=self.guide, shared_key='invented-departure')])
        with self.assertRaises(d.DomainError):
            d.create_quote(self.conn, second['id'], second_data)

    def test_stays_are_local_date_intervals_and_checkout_can_be_next_checkin(self):
        first = self.enquiry(starts_at='2030-05-01', ends_at='2030-05-02')
        self.assertEqual('2030-04-30T20:00:00Z', first['starts_at'])
        d.create_quote(self.conn, first['id'], self.quote_data())
        second = self.enquiry(starts_at='2030-05-02', ends_at='2030-05-03')
        d.create_quote(self.conn, second['id'], self.quote_data())
        self.assertEqual(2, self.conn.execute('SELECT COUNT(*) FROM quotes').fetchone()[0])

    def test_change_request_does_not_modify_booking_and_cancel_does_not_refund(self):
        enquiry, quote = self.accepted()
        d.record_payment(self.conn, quote['id'], 5000, reference='Cash collected by owner', verified=True)
        booking = d.confirm_booking(self.conn, quote['id'])
        request = d.request_change(self.conn, enquiry['id'], 'Please change arrival day')
        self.assertEqual('open', request['status'])
        self.assertEqual('confirmed', d.get_quote(self.conn, quote['id'])['booking']['status'])
        d.cancel_booking(self.conn, booking['id'], 'Guest cancellation agreed')
        self.assertEqual(5000, d.get_quote(self.conn, quote['id'])['paid_minor'])
        d.record_payment(self.conn, quote['id'], 5000, kind='refund', reference='Bank refund settled', verified=True)
        self.assertEqual(0, d.get_quote(self.conn, quote['id'])['paid_minor'])
        second = self.enquiry()
        d.create_quote(self.conn, second['id'], self.quote_data())

    def test_guest_token_is_hashed_expiring_and_enquiry_idempotent(self):
        enquiry = self.enquiry(idempotency_key='one-request-one-key')
        self.assertNotEqual(enquiry['guest_token'], enquiry['token_hash'])
        self.assertEqual(enquiry['id'], d.find_guest_enquiry(self.conn, enquiry['guest_token'])['id'])
        repeated = self.enquiry(idempotency_key='one-request-one-key')
        self.assertEqual(enquiry['id'], repeated['id'])
        self.assertNotIn('guest_token', repeated)
        self.conn.execute('UPDATE enquiries SET token_expires_at=? WHERE id=?', (d.timestamp(d.now() - timedelta(seconds=1)), enquiry['id']))
        self.assertIsNone(d.find_guest_enquiry(self.conn, enquiry['guest_token']))

    def test_inventory_block_cannot_hide_existing_hold(self):
        enquiry, quote = self.accepted()
        with self.assertRaises(d.DomainError):
            d.block_resource(self.conn, self.room, self.start, self.end, 'Conflicting maintenance')
        d.cancel_quote(self.conn, quote['id'], 'Guest declined')
        block = d.block_resource(self.conn, self.room, self.start, self.end, 'Maintenance')
        second = self.enquiry()
        with self.assertRaises(d.DomainError):
            d.create_quote(self.conn, second['id'], self.quote_data())
        d.remove_block(self.conn, block['id'])
        d.create_quote(self.conn, second['id'], self.quote_data())

    def test_partial_stay_times_still_reserve_the_whole_local_night(self):
        first = self.enquiry(starts_at='2030-05-01T20:00:00+04:00', ends_at='2030-05-02T08:00:00+04:00')
        self.assertEqual('2030-04-30T20:00:00Z', first['starts_at'])
        quote = d.create_quote(self.conn, first['id'], self.quote_data(items=[dict(kind='stay', title='Night', quantity=1, unit_price_minor=10000,
                              starts_at='2030-05-01T20:00:00+04:00', ends_at='2030-05-02T08:00:00+04:00')]))
        self.assertEqual('2030-04-30T20:00:00Z', quote['items'][0]['starts_at'])
        second = self.enquiry(starts_at='2030-05-01T02:00:00+04:00', ends_at='2030-05-02T03:00:00+04:00')
        with self.assertRaises(d.DomainError):
            d.create_quote(self.conn, second['id'], self.quote_data())
        with self.assertRaises(d.DomainError):
            d.replace_quote(self.conn, quote['id'], self.quote_data(allocations=[dict(resource_id=self.room,
                             starts_at='2030-05-01T20:00:00+04:00', ends_at='2030-05-02T08:00:00+04:00')]))

    def test_quote_replacement_requires_payment_reconciliation(self):
        enquiry, quote = self.accepted()
        payment = d.record_payment(self.conn, quote['id'], 5000, reference='Pending bank settlement')
        with self.assertRaises(d.DomainError):
            d.replace_quote(self.conn, quote['id'], self.quote_data())
        d.verify_payment(self.conn, payment['id'], 'Settled bank deposit')
        with self.assertRaises(d.DomainError):
            d.replace_quote(self.conn, quote['id'], self.quote_data())
        d.record_payment(self.conn, quote['id'], 5000, kind='refund', reference='Refund paid back', verified=True)
        replacement = d.replace_quote(self.conn, quote['id'], self.quote_data())
        self.assertEqual('offered', replacement['status'])
        self.assertEqual(0, replacement['paid_minor'])

    def test_one_person_can_guide_or_drive_but_cannot_overlap(self):
        enquiry, tour = self.accepted('tour', self.guide)
        taxi_enquiry, taxi = self.accepted('taxi', allocations=[])
        with self.assertRaises(d.DomainError):
            d.assign_driver(self.conn, taxi['id'], self.guide, self.vehicle)
        d.cancel_quote(self.conn, tour['id'], 'Tour declined')
        assignment = d.assign_driver(self.conn, taxi['id'], self.guide, self.vehicle)
        d.accept_assignment(self.conn, assignment['id'], 'Guide accepted driving job')
        d.confirm_booking(self.conn, taxi['id'])

    def test_driver_cannot_start_before_booking_confirmation(self):
        enquiry, quote = self.accepted('taxi', allocations=[])
        assignment = d.assign_driver(self.conn, quote['id'], self.driver, self.vehicle)
        d.accept_assignment(self.conn, assignment['id'], 'Driver accepted job')
        with self.assertRaises(d.DomainError):
            d.mark_assignment(self.conn, assignment['id'], 'en_route')
        d.confirm_booking(self.conn, quote['id'])
        self.assertEqual('en_route', d.mark_assignment(self.conn, assignment['id'], 'en_route')['status'])

    def test_unsettled_claim_can_be_voided_but_verified_money_needs_refund(self):
        enquiry, quote = self.accepted()
        payment = d.record_payment(self.conn, quote['id'], 5000, reference='Pending receipt')
        d.void_payment(self.conn, payment['id'], 'Business bank confirmed no funds settled')
        saved = d.get_quote(self.conn, quote['id'])
        self.assertEqual(0, saved['pending_minor'])
        self.assertEqual(0, saved['paid_minor'])
        with self.assertRaises(d.DomainError):
            d.verify_payment(self.conn, payment['id'], 'Attempt to verify old record')
        replacement = d.replace_quote(self.conn, quote['id'], self.quote_data())
        payment = d.record_payment(self.conn, replacement['id'], 5000, reference='Actual funds collected', verified=True)
        with self.assertRaises(d.DomainError):
            d.void_payment(self.conn, payment['id'], 'Cannot erase real money')

    def test_internal_stable_guest_token_supports_form_retries(self):
        token = 'a' * 64
        enquiry = self.enquiry(guest_token=token, idempotency_key='stable-form-request')
        repeated = self.enquiry(guest_token=token, idempotency_key='stable-form-request')
        self.assertEqual(token, enquiry['guest_token'])
        self.assertEqual(enquiry['id'], repeated['id'])
        self.assertEqual(enquiry['id'], d.find_guest_enquiry(self.conn, token)['id'])


if __name__ == '__main__':
    unittest.main()
