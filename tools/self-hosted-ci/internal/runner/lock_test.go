package runner

import "testing"

func TestAcquireLockExcludesOtherProcessesUntilRelease(t *testing.T) {
	storage := t.TempDir()
	first, err := AcquireLock(storage)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := AcquireLock(storage); err == nil {
		t.Fatal("expected a second lock acquisition to fail")
	}
	first()
	third, err := AcquireLock(storage)
	if err != nil {
		t.Fatal(err)
	}
	third()
}
