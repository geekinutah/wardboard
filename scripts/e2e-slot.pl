#!/usr/bin/env perl
# Machine-wide Playwright slot pool (T-091, backlog B-045).
#
# Usage: scripts/e2e-slot.pl <command> [args...]
#
# Takes one of S machine-wide slots, then execs `<command> [args...]
# --workers=<W>`, so the whole machine never runs more than S*W Playwright
# workers. When every slot is busy it waits, retrying all slots once a second.
#
# The lock is an flock on a slot file in a shared directory. The slot's
# descriptor survives exec, so the command itself holds the lock and the OS
# releases it when the command exits or is killed. Slot files are never
# truncated or deleted.
#
# Environment:
#   WARDBOARD_E2E_SLOTS     number of slots S (default 2)
#   WARDBOARD_E2E_WORKERS   Playwright workers per slot W (default 6)
#   WARDBOARD_E2E_SLOT_DIR  lock directory (default /tmp/wardboard-e2e-slots;
#                           deliberately not $TMPDIR, which differs per session)
use strict;
use warnings;
use Errno qw(EEXIST);
use Fcntl qw(:flock O_RDWR O_CREAT);

my $prog = 'e2e-slot';

sub fail {
    my ($status, $message) = @_;
    print STDERR "$prog: $message\n";
    exit $status;
}

if (!@ARGV) {
    fail(2, "usage: scripts/e2e-slot.pl <command> [args...]\n"
        . "Runs <command> [args...] --workers=<W> while holding one of the machine-wide e2e slots.");
}

sub positive_int {
    my ($name, $default) = @_;
    my $value = $ENV{$name};
    return $default if !defined $value;
    fail(2, "$name must be a positive integer, got '$value'") if $value !~ /\A[1-9][0-9]*\z/;
    return $value + 0;
}

my $slots   = positive_int('WARDBOARD_E2E_SLOTS', 2);
my $workers = positive_int('WARDBOARD_E2E_WORKERS', 6);
my $dir     = $ENV{WARDBOARD_E2E_SLOT_DIR} // '/tmp/wardboard-e2e-slots';

for my $arg (@ARGV) {
    if ($arg eq '--workers' || $arg =~ /\A--workers=/ || $arg =~ /\A-j/) {
        fail(2, "the worker count is fixed by the slot pool (workers=$workers); remove '$arg'");
    }
}

if (!mkdir $dir) {
    # Another wrapper creating it at the same moment is fine.
    fail(1, "cannot create $dir: $!") if $! != EEXIST || !-d $dir;
}

# Perl marks descriptors above $^F close-on-exec when it opens them. Raise it
# so the slot descriptor survives exec and the command holds the lock.
$^F = 1_000_000;

# Open every slot file (creating any that are missing), keep the first one
# whose non-blocking flock succeeds and close the others.
sub try_slots {
    my @handles;
    for my $i (0 .. $slots - 1) {
        my $path = "$dir/slot-$i";
        sysopen(my $fh, $path, O_RDWR | O_CREAT) or fail(1, "cannot open $path: $!");
        push @handles, $fh;
    }
    my ($slot, $held);
    for my $i (0 .. $#handles) {
        if (!defined $held && flock($handles[$i], LOCK_EX | LOCK_NB)) {
            ($slot, $held) = ($i, $handles[$i]);
        } else {
            close $handles[$i];
        }
    }
    return ($slot, $held);
}

my ($slot, $fh) = try_slots();
if (!defined $slot) {
    print STDERR "$prog: all $slots slots busy, waiting\n";
    until (defined $slot) {
        sleep 1;
        ($slot, $fh) = try_slots();
    }
}

print STDERR "$prog: slot $slot acquired, workers=$workers\n";
my @command = (@ARGV, "--workers=$workers");
{ no warnings 'exec'; exec { $command[0] } @command; }
fail(127, "cannot run $command[0]: $!");
