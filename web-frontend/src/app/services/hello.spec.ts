import { TestBed } from '@angular/core/testing';

import { Hello } from './hello';

describe('Hello', () => {
  let service: Hello;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Hello);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
